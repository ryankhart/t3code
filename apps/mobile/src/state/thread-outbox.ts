import { TALK_MODE_INSTRUCTION } from "@t3tools/shared/composerContextReferences";

import { appAtomRegistry } from "./atom-registry";
import { createThreadOutboxManager } from "./thread-outbox-manager";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { expoThreadOutboxStorage, flushThreadOutboxWrites } from "./thread-outbox-storage";

export * from "./thread-outbox-model";

export const threadOutboxManager = createThreadOutboxManager({
  registry: appAtomRegistry,
  storage: expoThreadOutboxStorage,
});

/** Drain queued mutations too; optimistic publication precedes the durable file write. */
export async function flushThreadOutbox(): Promise<void> {
  await threadOutboxManager.serialize(async () => {});
  await flushThreadOutboxWrites();
}

export interface TalkModeNote {
  readonly threadId: string;
  /** The trimmed text the message must have. */
  readonly text: string;
  /** `saved` settles with the outbox write. */
  readonly onQueued: (messageId: string, saved: Promise<void>) => void;
}

let talkModeNote: TalkModeNote | null = null;

/** Talk mode: the next matching message goes out with the spoken-reply note; null disarms. */
export function armTalkModeNote(note: TalkModeNote | null): void {
  talkModeNote = note;
}

export function enqueueThreadOutboxMessage(message: QueuedThreadMessage): Promise<void> {
  const note = talkModeNote;
  if (note === null || message.threadId !== note.threadId || message.text.trim() !== note.text) {
    return threadOutboxManager.enqueue(message);
  }
  talkModeNote = null;
  const saved = threadOutboxManager.enqueue({
    ...message,
    text: `${TALK_MODE_INSTRUCTION}${message.text}`,
  });
  note.onQueued(message.messageId, saved);
  return saved;
}

export function confirmThreadOutboxMessageQueued(message: QueuedThreadMessage): Promise<boolean> {
  return threadOutboxManager.confirmQueued(message);
}

/** Returns false if removed or if expectedRevision differs from threadOutboxRevision; otherwise rewrites the message. */
export function updateThreadOutboxMessage(
  message: QueuedThreadMessage,
  expectedRevision?: number,
): Promise<boolean> {
  return threadOutboxManager.update(message, expectedRevision);
}

/** Changes the message as it is when its turn comes; false when it is gone or `change` returns null. */
export function modifyThreadOutboxMessage(
  messageId: QueuedThreadMessage["messageId"],
  change: (message: QueuedThreadMessage) => QueuedThreadMessage | null,
): Promise<boolean> {
  return threadOutboxManager.modify(messageId, change);
}

export function threadOutboxRevision(messageId: QueuedThreadMessage["messageId"]): number {
  return threadOutboxManager.revisionOf(messageId);
}

// Removal needs draft-state ownership to release files; keep that dependency outside this module.
