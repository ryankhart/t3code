import { buildDraftActionMenuItems } from "@t3tools/client-runtime/thread-action-menu";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { msg } from "gt-react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { discardComposerDraft } from "../lib/discardComposerDraft";
import { m } from "../i18n/messages";
import { readLocalApi } from "../localApi";
import { useCopyToClipboard } from "./useCopyToClipboard";

function copyFailureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : m(msg("An error occurred.")),
    }),
  );
}

/** The thread header's menu for a thread that hasn't been sent yet; matches its sidebar row. */
export function useDraftActionMenu(input: {
  readonly draftId: DraftId | null;
  readonly projectCwd: string | null;
  readonly onOpenProjectSettings: (() => void) | undefined;
}) {
  const { draftId, projectCwd, onOpenProjectSettings } = input;
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onError: (error) => copyFailureToast(m(msg("Failed to copy path")), error),
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: "branch name",
    onError: (error) => copyFailureToast(m(msg("Failed to copy branch")), error),
  });

  const openMenu = (position: { x: number; y: number }) => {
    if (draftId === null) return;
    void (async () => {
      const api = readLocalApi();
      const session = useComposerDraftStore.getState().getDraftSession(draftId);
      if (!api || !session || session.promotedTo) return;
      const workspacePath = session.worktreePath ?? projectCwd;
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          buildDraftActionMenuItems(
            {
              hasPath: Boolean(workspacePath),
              hasBranch: Boolean(session.branch),
              hasProject: onOpenProjectSettings !== undefined,
            },
            m,
          ),
          position,
        ),
      );
      if (clicked._tag === "Failure") return;
      switch (clicked.value) {
        case "project-settings":
          onOpenProjectSettings?.();
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
