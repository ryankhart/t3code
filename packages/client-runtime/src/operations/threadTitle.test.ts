import { describe, expect, it } from "vite-plus/test";

import { TALK_MODE_INSTRUCTION } from "@t3tools/shared/composerContextReferences";

import { threadTitleTextFromPrompt } from "./threadTitle.ts";

describe("threadTitleTextFromPrompt", () => {
  it("names a mentioned model by its slug, without the reference syntax", () => {
    expect(threadTitleTextFromPrompt("Delegate to model:codex/gpt-6.1-sol and report back")).toBe(
      "Delegate to gpt-6.1-sol and report back",
    );
    expect(
      threadTitleTextFromPrompt("model:opencode/anthropic/opus, then model:codex/gpt-5.4."),
    ).toBe("anthropic/opus, then gpt-5.4.");
  });

  it("titles a talk mode message by what was said", () => {
    expect(threadTitleTextFromPrompt(`${TALK_MODE_INSTRUCTION}What is two plus two?`)).toBe(
      "What is two plus two?",
    );
  });
});
