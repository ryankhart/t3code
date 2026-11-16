import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadChipCopyTarget } from "@t3tools/client-runtime/thread-reference";
import * as Cause from "effect/Cause";

import * as Dialog from "../../components/ui/Dialog";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { copyThreadReference } from "../../lib/copyThreadReference";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * Thread menu actions that need no list or screen context (copying and marking unread), shared by
 * a thread's row menu and its header menu. Returns whether it handled the event.
 */
export function useThreadMenuUtilities() {
  const markUnread = useAtomCommand(threadEnvironment.markUnread, { reportFailure: false });
  return (event: string, thread: EnvironmentThreadShell, projectCwd: string | null): boolean => {
    switch (event) {
      case "copy-path": {
        const path = thread.worktreePath ?? projectCwd;
        if (path) copyTextWithHaptic(path, { target: "path" });
        else
          Dialog.alert("Path unavailable", "This thread does not have a workspace path to copy.");
        return true;
      }
      case "copy-branch":
        if (thread.branch) copyTextWithHaptic(thread.branch, { target: "branch" });
        return true;
      case "copy-thread": {
        const target = threadChipCopyTarget(
          { environmentId: thread.environmentId, threadId: thread.id },
          thread.title,
        );
        void copyThreadReference(target).then((didCopy) => {
          if (!didCopy) Dialog.alert(target.failureTitle, "Try copying this thread again.");
        });
        return true;
      }
      case "copy-thread-id":
        copyTextWithHaptic(thread.id, { target: "thread-id" });
        return true;
      case "mark-unread":
        void markUnread({
          environmentId: thread.environmentId,
          input: { threadId: thread.id },
        }).then((result) => {
          if (result._tag !== "Failure") return;
          const error = Cause.squash(result.cause);
          Dialog.alert(
            "Could not mark thread unread",
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Try again.",
          );
        });
        return true;
      default:
        return false;
    }
  };
}
