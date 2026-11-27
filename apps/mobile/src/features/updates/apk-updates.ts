import { requireOptionalNativeModule } from "expo";
import { AppState, type AppStateStatus, Platform } from "react-native";

import { defaultFlushPendingWrites, defaultIsSafeToRestartInBackground } from "./app-updates";

/** The fork's sideloaded APK replaces itself from its own GitHub releases (Android only). */
interface ApkUpdaterModule {
  versionCode(): number;
  canInstall(): boolean;
  isMetered(): boolean;
  openInstallPermissionSettings(): boolean;
  stage(fileUri: string, sha256: string): Promise<number>;
  /** `reopen` starts the new version once Android has replaced this one. */
  commit(sessionId: number, reopen: boolean): Promise<"pending_user_action" | "success">;
  confirmPendingInstall(): boolean;
}

export interface ApkUpdate {
  readonly version: string;
  readonly versionCode: number;
  readonly fileName: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
}

export interface DownloadedApk {
  readonly uri: string;
  readonly size: number;
  readonly dispose: () => void;
}

export interface ApkUpdateEnvironment {
  readonly updater: ApkUpdaterModule;
  readonly fetchLatestRelease: () => Promise<unknown>;
  readonly download: (update: ApkUpdate) => Promise<DownloadedApk>;
  readonly askForInstallPermission: (update: ApkUpdate) => void;
  readonly flushPendingWrites: () => Promise<void>;
  readonly isSafeToInstall: () => Promise<boolean>;
  readonly subscribeAppState: (onChange: (state: AppStateStatus) => void) => () => void;
  readonly now: () => number;
  readonly warn: (message: string, cause: unknown) => void;
}

const APK_NAME = /^T3-Code-Fork-(\d+)\.(\d+)\.(\d+)\.apk$/;
const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/i;
const RECHECK_AFTER_MS = 30 * 60 * 1000;

/** Same scheme as fork-build.yml: x.y.z -> x*10^7 + y*10^5 + z. */
export function apkVersionCode(major: number, minor: number, patch: number): number | null {
  if (minor >= 100 || patch >= 100_000) return null;
  return major * 10_000_000 + minor * 100_000 + patch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads a GitHub "latest release" response; null unless it carries a newer, checksummed APK. */
export function pickApkUpdate(release: unknown, installedVersionCode: number): ApkUpdate | null {
  if (!isRecord(release) || release.draft === true || release.prerelease === true) return null;
  if (!Array.isArray(release.assets)) return null;
  for (const asset of release.assets) {
    if (!isRecord(asset) || typeof asset.name !== "string") continue;
    const name = APK_NAME.exec(asset.name);
    if (!name) continue;
    const sha256 = typeof asset.digest === "string" ? SHA256_DIGEST.exec(asset.digest)?.[1] : null;
    const url = asset.browser_download_url;
    if (!sha256 || typeof url !== "string" || !url.startsWith("https://github.com/")) return null;
    if (typeof asset.size !== "number" || asset.size <= 0) return null;
    const versionCode = apkVersionCode(Number(name[1]), Number(name[2]), Number(name[3]));
    if (versionCode === null || versionCode <= installedVersionCode) return null;
    return {
      version: `${name[1]}.${name[2]}.${name[3]}`,
      versionCode,
      fileName: asset.name,
      url,
      size: asset.size,
      sha256: sha256.toLowerCase(),
    };
  }
  return null;
}

/**
 * Checks at launch and after a long stay away, downloads only on unmetered networks,
 * stages the APK while the app is in front, and installs it the next time the app
 * leaves the screen. Android ends the process on success; the next launch is the new version.
 */
export function installApkUpdateChecks(
  environment: ApkUpdateEnvironment | null = createDefaultEnvironment(),
): () => void {
  if (!environment) return () => undefined;
  const { updater } = environment;
  let staged: { readonly sessionId: number; readonly update: ApkUpdate } | null = null;
  let skippedVersionCode = 0;
  let askedVersionCode = 0;
  let busy = false;
  let awaitingConfirmation = false;
  let lastCheckAtMs = Number.NEGATIVE_INFINITY;
  let installWhenAllowed = false;

  const stageUpdate = async (update: ApkUpdate) => {
    if (staged?.update.versionCode === update.versionCode) return staged;
    const file = await environment.download(update);
    try {
      if (file.size !== update.size) throw new Error("The update download was incomplete.");
      staged = { sessionId: await updater.stage(file.uri, update.sha256), update };
      return staged;
    } finally {
      file.dispose();
    }
  };

  const check = async () => {
    if (busy) return;
    busy = true;
    lastCheckAtMs = environment.now();
    try {
      if (updater.isMetered()) return;
      const update = pickApkUpdate(await environment.fetchLatestRelease(), updater.versionCode());
      if (!update || update.versionCode <= skippedVersionCode) return;
      await stageUpdate(update);
      if (status.kind === "idle" || status.kind === "current") {
        setStatus({ kind: "available", update });
      }
      if (!updater.canInstall() && askedVersionCode !== update.versionCode) {
        askedVersionCode = update.versionCode;
        environment.askForInstallPermission(update);
      }
    } catch (cause) {
      environment.warn("Could not get the app update", cause);
    } finally {
      busy = false;
    }
  };

  const install = async () => {
    const target = staged;
    if (!target || busy || !updater.canInstall()) return;
    busy = true;
    try {
      await environment.flushPendingWrites();
      if (!(await environment.isSafeToInstall())) return;
      // A commit uses up the session, whatever happens next.
      staged = null;
      const result = await updater.commit(target.sessionId, false);
      if (result === "pending_user_action") awaitingConfirmation = true;
      skippedVersionCode = target.update.versionCode;
    } catch (cause) {
      skippedVersionCode = target.update.versionCode;
      environment.warn("Could not install the app update", cause);
    } finally {
      busy = false;
    }
  };

  // The Settings button: works on any network and installs right away, since the user asked.
  const checkNow = async () => {
    if (busy) return;
    busy = true;
    lastCheckAtMs = environment.now();
    setStatus({ kind: "checking" });
    try {
      const update = pickApkUpdate(await environment.fetchLatestRelease(), updater.versionCode());
      setStatus(update ? { kind: "available", update } : { kind: "current" });
    } catch (cause) {
      setStatus({ kind: "failed", message: describeFailure(cause) });
    } finally {
      busy = false;
    }
  };

  const installNow = async () => {
    const current = status;
    if (busy || (current.kind !== "available" && current.kind !== "permission")) return;
    const { update } = current;
    busy = true;
    try {
      setStatus({ kind: "downloading", update });
      const target = await stageUpdate(update);
      if (!updater.canInstall()) {
        installWhenAllowed = true;
        setStatus({ kind: "permission", update });
        updater.openInstallPermissionSettings();
        return;
      }
      installWhenAllowed = false;
      setStatus({ kind: "installing", update });
      await environment.flushPendingWrites();
      staged = null;
      const result = await updater.commit(target.sessionId, true);
      // Success ends this process, so only Android's own prompt or a failure gets here.
      if (result === "pending_user_action") {
        updater.confirmPendingInstall();
        setStatus({ kind: "available", update });
      }
    } catch (cause) {
      setStatus({ kind: "failed", message: describeFailure(cause) });
    } finally {
      busy = false;
    }
  };

  const unsubscribe = environment.subscribeAppState((state) => {
    if (state === "background") {
      void install();
      return;
    }
    if (state !== "active") return;
    if (awaitingConfirmation) {
      awaitingConfirmation = false;
      updater.confirmPendingInstall();
      return;
    }
    if (installWhenAllowed && status.kind === "permission" && updater.canInstall()) {
      void installNow();
      return;
    }
    if (environment.now() - lastCheckAtMs >= RECHECK_AFTER_MS) void check();
  });
  controls = { check: checkNow, install: installNow };
  void check();
  return () => {
    controls = null;
    unsubscribe();
  };
}

export type ApkUpdateStatus =
  | { readonly kind: "idle" | "checking" | "current" }
  | {
      readonly kind: "available" | "downloading" | "permission" | "installing";
      readonly update: ApkUpdate;
    }
  | { readonly kind: "failed"; readonly message: string };

let status: ApkUpdateStatus = { kind: "idle" };
const statusListeners = new Set<() => void>();
let controls: {
  readonly check: () => Promise<void>;
  readonly install: () => Promise<void>;
} | null = null;

function setStatus(next: ApkUpdateStatus) {
  status = next;
  for (const listener of statusListeners) listener();
}

function describeFailure(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : String(cause);
}

export function getApkUpdateStatus(): ApkUpdateStatus {
  return status;
}

export function subscribeApkUpdateStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Only the fork's release APK can update itself; other builds have no button. */
export function isApkUpdateButtonAvailable(): boolean {
  return controls !== null;
}

export function checkApkUpdateNow(): Promise<void> {
  return controls?.check() ?? Promise.resolve();
}

export function installApkUpdateNow(): Promise<void> {
  return controls?.install() ?? Promise.resolve();
}

function createDefaultEnvironment(): ApkUpdateEnvironment | null {
  // Set only by the fork's release build, so dev and upstream builds never self-update.
  const repository = process.env.EXPO_PUBLIC_T3_APK_UPDATES_REPO;
  if (Platform.OS !== "android" || !repository || __DEV__) return null;
  const updater = requireOptionalNativeModule<ApkUpdaterModule>("T3ApkUpdater");
  if (!updater) return null;
  return {
    updater,
    fetchLatestRelease: async () => {
      const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
      return response.json();
    },
    download: async (update) => {
      const { File, Paths } = await import("expo-file-system");
      const file = new File(Paths.cache, update.fileName);
      if (file.exists) file.delete();
      const downloaded = await File.downloadFileAsync(update.url, file);
      return {
        uri: downloaded.uri,
        size: downloaded.size,
        dispose: () => {
          if (downloaded.exists) downloaded.delete();
        },
      };
    },
    askForInstallPermission: (update) => {
      void import("../../components/ui/Dialog").then((Dialog) =>
        Dialog.alert(
          "Let T3 Code Fork update itself",
          `Version ${update.version} is downloaded. Allow "Install unknown apps" for T3 Code Fork once, and from then on new versions install by themselves when you leave the app.`,
          [
            { style: "cancel", text: "Not now" },
            { onPress: () => updater.openInstallPermissionSettings(), text: "Allow" },
          ],
        ),
      );
    },
    flushPendingWrites: defaultFlushPendingWrites,
    isSafeToInstall: defaultIsSafeToRestartInBackground,
    subscribeAppState: (onChange) => {
      const subscription = AppState.addEventListener("change", onChange);
      return () => subscription.remove();
    },
    now: Date.now,
    warn: (message, cause) => console.warn(`[apk-updates] ${message}`, cause),
  };
}
