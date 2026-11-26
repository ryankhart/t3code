import type { OrchestrationV2RunStatus } from "@t3tools/contracts";
import { TALK_MODE_INSTRUCTION } from "@t3tools/shared/composerContextReferences";

import type { ThreadFeedEntry } from "../../lib/threadActivity";

export interface TalkReply {
  readonly id: string;
  readonly markdown: string;
}

/** How the run for a sent message stands. */
export type TalkAnswer =
  /** Not picked up by a run yet. */
  | { readonly kind: "unanswered" }
  /** Its run is waiting its turn behind another one. */
  | { readonly kind: "queued" }
  /** Its run finished without a reply. */
  | { readonly kind: "silent" }
  | { readonly kind: "pending" }
  /** The answer so far, while its run goes on or it's still arriving. */
  | { readonly kind: "partial"; readonly messageId: string; readonly reply: TalkReply }
  | { readonly kind: "ready"; readonly messageId: string; readonly reply: TalkReply }
  /**
   * Its run stopped short (interrupted, failed, rolled back), someone steered it afterwards, or
   * it was edited into a typed message before it ran.
   */
  | { readonly kind: "none"; readonly messageId: string };

export const UNANSWERED: TalkAnswer = { kind: "unanswered" };
export const QUEUED: TalkAnswer = { kind: "queued" };
export const PENDING: TalkAnswer = { kind: "pending" };
export const SILENT: TalkAnswer = { kind: "silent" };

const SETTLED = new Set<OrchestrationV2RunStatus>([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

export function talkAnswer(
  feed: ReadonlyArray<ThreadFeedEntry>,
  runs: ReadonlyArray<{
    readonly id: string;
    readonly userMessageId: string;
    readonly status: OrchestrationV2RunStatus;
  }> | null,
  messageId: string,
): TalkAnswer {
  const sent = feed.findIndex(
    (entry) => entry.type === "message" && entry.message.id === messageId,
  );
  const sentEntry = feed[sent];
  const sentMessage = sentEntry?.type === "message" ? sentEntry.message : null;
  // Edited on another device before it ran: the answer is to someone's typed words.
  if (sentMessage && !sentMessage.text.startsWith(TALK_MODE_INSTRUCTION)) {
    return { kind: "none", messageId };
  }
  const runId = sentMessage?.runId ?? null;
  // A queued message has its run before it shows in the feed.
  const run = runs?.find((candidate) =>
    runId === null ? candidate.userMessageId === messageId : candidate.id === runId,
  );
  if (run === undefined) return UNANSWERED;
  const status = run.status;
  // Held after a stop, a queued run may never start, so only a busy thread waits for it.
  if (status === "queued") return QUEUED;
  const after = (sentMessage ? feed.slice(sent + 1) : []).filter(
    (entry) => (entry.type === "message" ? entry.message.runId : entryRunId(entry)) === run.id,
  );
  // Someone steered the run after it, so its last words may answer them instead.
  if (after.some((entry) => entry.type === "message" && entry.message.role === "user")) {
    return { kind: "none", messageId };
  }
  const settled = SETTLED.has(status);
  if (settled && status !== "completed") return { kind: "none", messageId };
  let last: ThreadFeedEntry | undefined;
  for (const entry of after) {
    if (entry.type !== "message") {
      // Untagged words before a tool call were progress, not the answer.
      if (isTool(entry) && last?.type === "message" && phaseOf(last) === undefined) {
        last = undefined;
      }
      continue;
    }
    // Progress notes aren't the answer; providers that don't tag phases send only answers.
    const phase = phaseOf(entry);
    if (phase !== undefined && phase !== "final_answer") continue;
    last = entry;
  }
  if (last?.type !== "message") return settled ? SILENT : PENDING;
  const reply = { id: last.message.id, markdown: last.message.text };
  // While the run goes on, or the reply is still arriving, it may yet turn out to be progress.
  if (!settled || last.message.streaming) return { kind: "partial", messageId, reply };
  return { kind: "ready", messageId, reply };
}

function phaseOf(entry: Extract<ThreadFeedEntry, { type: "message" }>): string | undefined {
  const item = entry.message.projectedItem?.item;
  return item?.type === "assistant_message" ? item.phase : undefined;
}

function entryRunId(entry: ThreadFeedEntry): string | null {
  return "runId" in entry ? entry.runId : null;
}

/** Tool calls and tool cards (a rendered page, a sent message), not notices such as limits. */
function isTool(entry: ThreadFeedEntry): boolean {
  if (entry.type === "activity-group") return entry.activities.some((item) => item.toolLike);
  return (
    entry.type === "work-toggle" ||
    entry.type === "html-render" ||
    entry.type === "sent-message" ||
    entry.type === "mcp-app"
  );
}
