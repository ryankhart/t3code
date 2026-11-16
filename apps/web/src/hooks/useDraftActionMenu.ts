import { buildDraftActionMenuItems } from "@t3tools/client-runtime/thread-action-menu";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { ContextMenuSource } from "@t3tools/contracts";
import { msg } from "gt-react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useComposerDraftStore, type DraftId, type DraftSessionState } from "../composerDraftStore";
import { discardComposerDraft } from "../lib/discardComposerDraft";
import { readLocalApi } from "../localApi";
import { useCopyToClipboard } from "./useCopyToClipboard";

function copyFailureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/** Where a draft's menu was opened decides how its project folder and settings are found. */
type DraftMenuPlace = (session: DraftSessionState) => {
  readonly workspaceRoot: string | null | undefined;
  readonly openProjectSettings: (() => void) | undefined;
};

/** A thread that hasn't been sent yet: the same menu from its sidebar row and its thread header. */
export function useDraftActionMenu() {
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onError: (error) => copyFailureToast("Failed to copy path", error),
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: {
      target: "branch name",
      unavailableMessage: msg("Clipboard API is unavailable while copying branch name."),
      failureMessage: msg("Failed to copy branch name to the clipboard."),
    },
    onError: (error) => copyFailureToast("Failed to copy branch", error),
  });

  const openMenu = (
    draftId: DraftId,
    position: { x: number; y: number },
    place: DraftMenuPlace,
    source?: ContextMenuSource,
  ) => {
    void (async () => {
      const api = readLocalApi();
      const session = useComposerDraftStore.getState().getDraftSession(draftId);
      if (!api || !session || session.promotedTo) return;
      const { workspaceRoot, openProjectSettings } = place(session);
      const workspacePath = session.worktreePath ?? workspaceRoot;
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          buildDraftActionMenuItems({
            hasPath: Boolean(workspacePath),
            hasBranch: Boolean(session.branch),
            hasProject: openProjectSettings !== undefined,
          }),
          position,
          source,
        ),
      );
      if (clicked._tag === "Failure") return;
      switch (clicked.value) {
        case "project-settings":
          openProjectSettings?.();
          return;
        case "copy-path":
          if (workspacePath) copyPathToClipboard(workspacePath, { path: workspacePath });
          return;
        case "copy-branch":
          if (session.branch) copyBranchToClipboard(session.branch, { branch: session.branch });
          return;
        case "discard": {
          // The menu may outlive draft promotion; discarding then would strand the send.
          const current = useComposerDraftStore.getState().getDraftSession(draftId);
          if (current && !current.promotedTo) discardComposerDraft(draftId);
          return;
        }
      }
    })();
  };

  return { openMenu };
}
