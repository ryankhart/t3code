// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalTimers:off -- Adapter over electron-chrome-extensions, whose callbacks and loaders run outside the Effect runtime.
import type { DesktopPreviewExtension, DesktopPreviewExtensionsState } from "@t3tools/contracts";
import { app, BrowserWindow, type Session, type WebContents, nativeImage } from "electron";
import type { ElectronChromeExtensions } from "electron-chrome-extensions";
import * as NodePath from "node:path";

import { chromeWebStoreExtensionId } from "@t3tools/shared/chromeWebStore";

const UPDATE_INTERVAL_MS = 5 * 60 * 60 * 1000;
const ICON_SIZE = 32;
const EXTENSION_WINDOW_OPTIONS = { width: 1024, height: 768, autoHideMenuBar: true } as const;

// Loaded on first use, so modules importing this one still load against a mocked electron in tests.
let extensionsLibrary: typeof import("electron-chrome-extensions") | undefined;
let webStoreLibrary: typeof import("electron-chrome-web-store") | undefined;
const instanceFor = (session: Session) =>
  extensionsLibrary?.ElectronChromeExtensions.fromSession(session);

interface ActionDetails {
  readonly title?: string;
  readonly text?: string;
  readonly color?: string;
  readonly popup?: string;
  readonly iconModified?: number;
}
interface BrowserActionState {
  readonly actions: ReadonlyArray<
    ActionDetails & { readonly id: string; readonly tabs: Record<string, ActionDetails> }
  >;
}
interface BrowserActionObserver {
  isDestroyed(): boolean;
  send(channel: string): void;
}
// electron-chrome-extensions keeps these private; the version is pinned in package.json.
interface BrowserActionInternals {
  readonly observers: Set<BrowserActionObserver>;
  getState(): BrowserActionState;
  activate(
    event: { readonly type: "frame"; readonly sender: WebContents },
    details: {
      readonly eventType: "click" | "contextmenu";
      readonly extensionId: string;
      readonly tabId: number;
      readonly anchorRect: { x: number; y: number; width: number; height: number };
      readonly alignment?: string;
    },
  ): void;
  handleCRXRequest(request: Request): Response;
}
const browserActionOf = (extensions: ElectronChromeExtensions): BrowserActionInternals =>
  (extensions as unknown as { readonly api: { readonly browserAction: BrowserActionInternals } })
    .api.browserAction;

const changeListeners = new Set<() => void>();
const notifyChange = () => {
  for (const listener of changeListeners) listener();
};
/** Fires when any profile's extensions, badges, titles or icons change. */
export function subscribeExtensionChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

const extensionsPathFor = (partition: string) =>
  NodePath.join(app.getPath("userData"), "preview-extensions", partition.replace(/^persist:/, ""));

const extensionsPaths = new WeakMap<Session, string>();

// The library also reports preview guests to selectTab/removeTab; only windows opened here are ours.
const extensionWindows = new WeakSet<Electron.BaseWindow>();

const openExtensionWindow = (session: Session, url: string | undefined): BrowserWindow => {
  const window = new BrowserWindow({
    ...EXTENSION_WINDOW_OPTIONS,
    webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  extensionWindows.add(window);
  if (url) void window.loadURL(url).catch(() => undefined);
  return window;
};

const ownedWindow = (window: Electron.BaseWindow | undefined) =>
  window !== undefined && extensionWindows.has(window) && !window.isDestroyed()
    ? window
    : undefined;

/** Gives a persistent preview profile Chrome extension APIs and loads its installed extensions. */
export async function enableExtensions(session: Session, partition: string): Promise<void> {
  extensionsLibrary ??= await import("electron-chrome-extensions");
  const webStore = (webStoreLibrary ??= await import("electron-chrome-web-store"));
  if (instanceFor(session)) return;
  const extensionsPath = extensionsPathFor(partition);
  extensionsPaths.set(session, extensionsPath);
  const extensions = new extensionsLibrary.ElectronChromeExtensions({
    session,
    // Extension pages open in their own window: preview tabs belong to the renderer's tab strip.
    createTab: async (details) => {
      const window = openExtensionWindow(session, details.url);
      return [window.webContents, window];
    },
    selectTab: (_tab, window) => {
      ownedWindow(window)?.focus();
    },
    removeTab: (_tab, window) => {
      ownedWindow(window)?.close();
    },
    createWindow: async (details) => {
      const url = Array.isArray(details.url) ? details.url[0] : details.url;
      const window = openExtensionWindow(session, url);
      if (details.width && details.height) {
        window.setSize(details.width, details.height);
      }
      return window;
    },
    removeWindow: (window) => {
      ownedWindow(window)?.close();
    },
  });
  browserActionOf(extensions).observers.add({
    isDestroyed: () => false,
    send: notifyChange,
  });
  session.extensions.on("extension-loaded", notifyChange);
  session.extensions.on("extension-unloaded", notifyChange);
  void webStore
    .loadAllExtensions(session, extensionsPath)
    .then(() => webStore.updateExtensions(session))
    .catch((error: unknown) => {
      console.warn("[preview-extensions] loading extensions failed", error);
    });
  setInterval(() => {
    void webStore.updateExtensions(session).catch(() => undefined);
  }, UPDATE_INTERVAL_MS).unref();
}

/** Lets extensions see a preview guest through chrome.tabs. */
export function trackExtensionTab(guest: WebContents): void {
  const extensions = instanceFor(guest.session);
  const host = guest.hostWebContents;
  if (!extensions || !host) return;
  const window = BrowserWindow.fromWebContents(host);
  if (!window) return;
  extensions.addTab(guest, window);
  guest.on("focus", () => {
    if (!guest.isDestroyed()) extensions.selectTab(guest);
  });
}

export function extensionContextMenuItems(
  contents: WebContents,
  params: Electron.ContextMenuParams,
): ReadonlyArray<Electron.MenuItem> {
  return instanceFor(contents.session)?.getContextMenuItems(contents, params) ?? [];
}

const largestManifestIcon = (extension: Electron.Extension): string | undefined => {
  const icons = (extension.manifest as { icons?: Record<string, string> }).icons ?? {};
  const sizes = Object.keys(icons)
    .map(Number)
    .filter((size) => Number.isFinite(size))
    .toSorted((a, b) => a - b);
  const size = sizes.find((candidate) => candidate >= ICON_SIZE) ?? sizes.at(-1);
  return size === undefined ? undefined : icons[String(size)];
};

const iconDataUrl = async (
  browserAction: BrowserActionInternals,
  extension: Electron.Extension,
  tabId: number,
  hasAction: boolean,
): Promise<string | null> => {
  if (hasAction) {
    const response = browserAction.handleCRXRequest(
      new Request(`crx://extension-icon/${extension.id}/${ICON_SIZE}/2?tabId=${tabId}`),
    );
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      return `data:image/png;base64,${bytes.toString("base64")}`;
    }
  }
  const iconPath = largestManifestIcon(extension);
  if (!iconPath) return null;
  const image = nativeImage.createFromPath(NodePath.join(extension.path, iconPath));
  return image.isEmpty() ? null : image.resize({ width: ICON_SIZE }).toDataURL();
};

const optionsPageOf = (extension: Electron.Extension): string | undefined => {
  const manifest = extension.manifest as {
    options_page?: string;
    options_ui?: { page?: string };
  };
  return manifest.options_page ?? manifest.options_ui?.page;
};

export async function extensionsState(guest: WebContents): Promise<DesktopPreviewExtensionsState> {
  const extensions = instanceFor(guest.session);
  if (!extensions) return { supported: false, extensions: [] };
  const browserAction = browserActionOf(extensions);
  const actions = new Map(browserAction.getState().actions.map((action) => [action.id, action]));
  const tabKey = String(guest.id);
  const loaded = guest.session.extensions
    .getAllExtensions()
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const entries = await Promise.all(
    loaded.map(async (extension): Promise<DesktopPreviewExtension> => {
      const action = actions.get(extension.id);
      const forTab = { ...action, ...action?.tabs[tabKey] };
      return {
        id: extension.id,
        name: extension.name,
        version: extension.version,
        hasAction: action !== undefined,
        title: forTab.title || extension.name,
        badgeText: forTab.text ?? "",
        badgeColor: forTab.color ?? null,
        iconDataUrl: await iconDataUrl(browserAction, extension, guest.id, action !== undefined),
        optionsPage: optionsPageOf(extension) !== undefined,
      };
    }),
  );
  return { supported: true, extensions: entries };
}

const requireExtensions = (guest: WebContents) => {
  const extensions = instanceFor(guest.session);
  const extensionsPath = extensionsPaths.get(guest.session);
  if (!extensions || !extensionsPath || !webStoreLibrary) {
    throw new Error("Extensions are not available in this browser profile.");
  }
  return { extensions, extensionsPath, webStore: webStoreLibrary };
};

export function activateExtension(
  guest: WebContents,
  input: {
    readonly extensionId: string;
    readonly button: "click" | "contextmenu";
    readonly anchor: { x: number; y: number; width: number; height: number };
  },
): void {
  const { extensions } = requireExtensions(guest);
  const host = guest.hostWebContents ?? guest;
  extensions.selectTab(guest);
  browserActionOf(extensions).activate(
    { type: "frame", sender: host },
    {
      eventType: input.button,
      extensionId: input.extensionId,
      tabId: guest.id,
      anchorRect: input.anchor,
    },
  );
}

export async function installWebStoreExtension(
  guest: WebContents,
  source: string,
): Promise<DesktopPreviewExtension> {
  const { extensionsPath, webStore } = requireExtensions(guest);
  const extensionId = chromeWebStoreExtensionId(source);
  if (!extensionId) {
    throw new Error("That isn't a Chrome Web Store extension link or ID.");
  }
  await webStore.installExtension(extensionId, { session: guest.session, extensionsPath });
  const installed = (await extensionsState(guest)).extensions.find(
    (extension) => extension.id === extensionId,
  );
  if (!installed) throw new Error("The extension was downloaded but did not load.");
  return installed;
}

export async function removeExtension(guest: WebContents, extensionId: string): Promise<void> {
  const { extensionsPath, webStore } = requireExtensions(guest);
  await webStore.uninstallExtension(extensionId, { session: guest.session, extensionsPath });
}

export function openExtensionOptions(guest: WebContents, extensionId: string): void {
  requireExtensions(guest);
  const extension = guest.session.extensions.getExtension(extensionId);
  const page = extension ? optionsPageOf(extension) : undefined;
  if (!extension || !page) throw new Error("This extension has no options page.");
  openExtensionWindow(guest.session, new URL(page, extension.url).href);
}
