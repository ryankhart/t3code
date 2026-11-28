import { describe, expect, it } from "vite-plus/test";
import { CHAT_LIST_ANCHOR_OFFSET, resolveChatListAnchoredEndSpace } from "./chatList.ts";

const items = [
  { id: "prompt-1", prompt: true },
  { id: "reply-1", prompt: false },
  { id: "prompt-2", prompt: true },
  { id: "reply-2", prompt: false },
];
const promptId = (item: (typeof items)[number]) => (item.prompt ? item.id : null);

describe("resolveChatListAnchoredEndSpace", () => {
  it("anchors only a thread's first prompt by default", () => {
    expect(resolveChatListAnchoredEndSpace(items, "prompt-1", promptId)).toEqual({
      anchorIndex: 0,
      anchorOffset: CHAT_LIST_ANCHOR_OFFSET,
    });
    expect(resolveChatListAnchoredEndSpace(items, "prompt-2", promptId)).toBeUndefined();
  });

  it("anchors a follow-up prompt when asked to anchor any prompt", () => {
    expect(
      resolveChatListAnchoredEndSpace(items, "prompt-2", promptId, {
        anchorOffset: 40,
        anyPrompt: true,
      }),
    ).toEqual({ anchorIndex: 2, anchorOffset: 40 });
    expect(
      resolveChatListAnchoredEndSpace(items, "gone", promptId, { anyPrompt: true }),
    ).toBeUndefined();
  });
});
