import type { DesktopPreviewExtension, DesktopPreviewExtensionsState } from "@t3tools/contracts";
import { chromeWebStoreExtensionId } from "@t3tools/shared/chromeWebStore";
import { Puzzle } from "lucide-react";
import { type MouseEvent, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { previewBridge } from "./previewBridge";

const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/";
const EMPTY_STATE: DesktopPreviewExtensionsState = { supported: false, extensions: [] };

interface Props {
  /** Null until the tab's page has attached. */
  readonly runtimeTabId: string | null;
  /** Whether the tab's page is attached; extensions are looked up through it. */
  readonly attached: boolean;
  readonly url: string;
  readonly onNavigate: (url: string) => void;
}

const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': /, "")
    : "";

export function PreviewExtensionsToolbar({ runtimeTabId, attached, url, onNavigate }: Props) {
  const bridge = previewBridge?.extensions;
  const [state, setState] = useState<{
    readonly tabId: string;
    readonly value: DesktopPreviewExtensionsState;
  } | null>(null);
  const [installing, setInstalling] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the main process's extension list and badges for this tab
  useEffect(() => {
    if (!bridge || !runtimeTabId || !attached) return;
    let cancelled = false;
    const refresh = () => {
      void bridge
        .getState(runtimeTabId)
        .then((value) => {
          if (!cancelled) setState({ tabId: runtimeTabId, value });
        })
        .catch(() => undefined);
    };
    refresh();
    const unsubscribe = bridge.onChange(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge, runtimeTabId, attached]);

  if (!bridge || !runtimeTabId) return null;
  const current = state?.tabId === runtimeTabId ? state.value : EMPTY_STATE;
  if (!current.supported) return null;

  const activate = (
    extension: DesktopPreviewExtension,
    button: "click" | "contextmenu",
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
    void bridge
      .activate({
        tabId: runtimeTabId,
        extensionId: extension.id,
        button,
        anchor: { x, y, width, height },
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: `${extension.name} failed`,
          description: errorText(error),
        });
      });
  };

  // Only a detail page names one extension; a bare ID in the address bar is a search.
  const detailId = url.startsWith("https://") ? chromeWebStoreExtensionId(url) : null;
  const detailInstalled = current.extensions.some((extension) => extension.id === detailId);
  const install = () => {
    if (!detailId || installing) return;
    setInstalling(true);
    void bridge
      .install(runtimeTabId, url)
      .then((extension) => {
        toastManager.add({ type: "success", title: `Added ${extension.name}` });
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Couldn't add this extension",
          description: errorText(error),
        });
      })
      .finally(() => setInstalling(false));
  };
  const remove = (extension: DesktopPreviewExtension) => {
    void bridge.remove(runtimeTabId, extension.id).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: `Couldn't remove ${extension.name}`,
        description: errorText(error),
      });
    });
  };
  const openOptions = (extension: DesktopPreviewExtension) => {
    void bridge.openOptions(runtimeTabId, extension.id).catch(() => undefined);
  };

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Extensions">
      {current.extensions
        .filter((extension) => extension.hasAction)
        .map((extension) => (
          <Tooltip key={extension.id}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  aria-label={extension.title}
                  onClick={(event) => activate(extension, "click", event)}
                  onContextMenu={(event) => activate(extension, "contextmenu", event)}
                />
              }
            >
              <span className="relative flex size-4 items-center justify-center">
                {extension.iconDataUrl ? (
                  <img src={extension.iconDataUrl} alt="" className="size-4" draggable={false} />
                ) : (
                  <Puzzle />
                )}
                {extension.badgeText ? (
                  <span
                    className="absolute -right-1.5 -bottom-1 rounded-sm px-0.5 text-3xs leading-3 font-medium text-white"
                    style={{ backgroundColor: extension.badgeColor ?? "#666" }}
                  >
                    {extension.badgeText}
                  </span>
                ) : null}
              </span>
            </TooltipTrigger>
            <TooltipPopup>{extension.title}</TooltipPopup>
          </Tooltip>
        ))}
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <Button variant="ghost" size="icon-xs" type="button" aria-label="Extensions" />
                }
              />
            }
          >
            <Puzzle />
          </TooltipTrigger>
          <TooltipPopup>Extensions</TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" sideOffset={6}>
          {detailId && !detailInstalled ? (
            <>
              <MenuItem onClick={install} disabled={installing}>
                {installing ? "Adding this extension…" : "Add this extension"}
              </MenuItem>
              <MenuSeparator />
            </>
          ) : null}
          {current.extensions.map((extension) => (
            <MenuSub key={extension.id}>
              <MenuSubTrigger>
                {extension.iconDataUrl ? (
                  <img src={extension.iconDataUrl} alt="" className="size-4" draggable={false} />
                ) : (
                  <Puzzle />
                )}
                <span className="max-w-48 truncate">{extension.name}</span>
              </MenuSubTrigger>
              <MenuSubPopup>
                {extension.optionsPage ? (
                  <MenuItem onClick={() => openOptions(extension)}>Options</MenuItem>
                ) : null}
                <MenuItem onClick={() => remove(extension)}>Remove</MenuItem>
              </MenuSubPopup>
            </MenuSub>
          ))}
          {current.extensions.length > 0 ? <MenuSeparator /> : null}
          <MenuItem onClick={() => onNavigate(CHROME_WEB_STORE_URL)}>
            Get extensions from the Chrome Web Store
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}
