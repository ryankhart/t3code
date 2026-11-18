import type { OrchestrationV2RunStatus } from "@t3tools/contracts";
import { TALK_MODE_INSTRUCTION } from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";

import type { ThreadFeedEntry } from "../../lib/threadActivity";
import { PENDING, QUEUED, SILENT, talkAnswer, UNANSWERED } from "./talkAnswer";

const message = (
  id: string,
  role: "user" | "assistant",
  runId: string | null,
  streaming = false,
  phase?: "commentary" | "final_answer",
): ThreadFeedEntry =>
  ({
    type: "message",
    id,
    createdAt: "2026-11-17T00:00:00.000Z",
    message: {
      id,
      role,
      runId,
      streaming,
      text: role === "user" ? `${TALK_MODE_INSTRUCTION}Text ${id}.` : `Text ${id}.`,
      ...(phase ? { projectedItem: { item: { type: "assistant_message", phase } } } : {}),
    },
  }) as unknown as ThreadFeedEntry;

const tool = (id: string, runId: string, toolLike = true): ThreadFeedEntry =>
  ({
    type: "activity-group",
    id,
    createdAt: "2026-11-17T00:00:00.000Z",
    runId,
    activities: [{ toolLike }],
  }) as unknown as ThreadFeedEntry;

const runs = (status: OrchestrationV2RunStatus) => [{ id: "r1", userMessageId: "m1", status }];

describe("talkAnswer", () => {
  const asked = message("m1", "user", "r1");
  const working = message("a0", "assistant", "r1");
  const final = message("a1", "assistant", "r1");
  const later = [message("m2", "user", "r2"), message("b1", "assistant", "r2", true)];

  it.each([
    ["not in the thread yet", [], null, UNANSWERED],
    ["not picked up by a run", [message("m1", "user", null)], null, UNANSWERED],
    ["queued", [asked], runs("queued"), QUEUED],
    ["queued, before the thread shows it", [], runs("queued"), QUEUED],
    ["cancelled from the queue", [], runs("cancelled"), { kind: "none", messageId: "m1" }],
    ["dropped from the queue", [], [], UNANSWERED],
    [
      "edited into typed words on another device",
      [
        {
          ...asked,
          message: { ...(asked as { message: object }).message, text: "Typed" },
        } as ThreadFeedEntry,
        final,
      ],
      runs("completed"),
      { kind: "none", messageId: "m1" },
    ],
    ["running", [asked, working], runs("running"), PENDING],
    // Its run is over, so a reply that stops arriving can't hold talk mode forever.
    [
      "finishing its last words",
      [asked, message("a1", "assistant", "r1", true)],
      runs("completed"),
      SILENT,
    ],
    [
      "answered, then a usage notice",
      [asked, message("a1", "assistant", "r1"), tool("n1", "r1", false)],
      runs("completed"),
      { kind: "ready", messageId: "m1", reply: { id: "a1", markdown: "Text a1." } },
    ],
    ["finished without a reply", [asked], runs("completed"), SILENT],
    [
      "finished on an untagged progress line before a tool call",
      [asked, message("p1", "assistant", "r1"), tool("t1", "r1")],
      runs("completed"),
      SILENT,
    ],
    [
      "finished on a progress line before a tool card",
      [
        asked,
        message("p1", "assistant", "r1"),
        {
          type: "html-render",
          id: "h1",
          createdAt: "2026-11-17T00:00:00.000Z",
          runId: "r1",
        } as unknown as ThreadFeedEntry,
      ],
      runs("completed"),
      SILENT,
    ],
    [
      "answered after its tool calls",
      [asked, message("p1", "assistant", "r1"), tool("t1", "r1"), final],
      runs("completed"),
      { kind: "ready", messageId: "m1", reply: { id: "a1", markdown: "Text a1." } },
    ],
    [
      "finished with only a progress note",
      [asked, message("c1", "assistant", "r1", false, "commentary")],
      runs("completed"),
      SILENT,
    ],
    [
      "answered, with a progress note after it",
      [
        asked,
        message("a1", "assistant", "r1", false, "final_answer"),
        message("c2", "assistant", "r1", false, "commentary"),
      ],
      runs("completed"),
      { kind: "ready", messageId: "m1", reply: { id: "a1", markdown: "Text a1." } },
    ],
    ["interrupted", [asked, working], runs("interrupted"), { kind: "none", messageId: "m1" }],
    // A run passes through "waiting" at the end of every turn, while its checkpoint is taken.
    ["finishing its turn", [asked, final], runs("waiting"), PENDING],
    [
      "steered by someone else while it runs",
      [asked, working, message("s1", "user", "r1")],
      runs("running"),
      { kind: "none", messageId: "m1" },
    ],
    [
      "steered by someone else before its answer",
      [asked, working, message("s1", "user", "r1"), final],
      runs("completed"),
      { kind: "none", messageId: "m1" },
    ],
    [
      "answered, with another device's turn after it",
      [asked, working, final, ...later],
      runs("completed"),
      { kind: "ready", messageId: "m1", reply: { id: "a1", markdown: "Text a1." } },
    ],
  ] as const)("reads a message that is %s", (_case, feed, runStatus, expected) => {
    expect(talkAnswer(feed, runStatus, "m1")).toEqual(expected);
  });
});
