import type { VoiceTranscriber } from "@t3tools/client-runtime/voice-input";
import type { SpeechPostProcessingOptions } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createDictationPostProcess, withDictationTidy } from "./dictationPipeline";
import { DEFAULT_DICTATION_STYLE } from "./dictationStyle";

const signal = new AbortController().signal;
const draft = { ownerKey: "draft", text: "", selection: { start: 0, end: 0 } };

describe("withDictationTidy", () => {
  it("quick-fixes live and recorded transcripts and keeps the live locale", async () => {
    let locale = "auto";
    const transcriber: VoiceTranscriber = {
      prepare: async () => ({
        get locale() {
          return locale;
        },
        start: async () => "Um, it thinks I raised my? Raised my tone.",
        transcribe: async () => "Don't do that?",
      }),
    };
    const prepared = await withDictationTidy(transcriber, () => DEFAULT_DICTATION_STYLE).prepare({
      signal,
    });
    locale = "en-US";
    expect(prepared.locale).toBe("en-US");
    expect(await prepared.start?.("file:///a", { signal })).toBe(
      "It thinks I raised my raised my tone.",
    );
    expect(await prepared.transcribe("file:///a", { signal })).toBe("Don't do that.");
  });
});

describe("createDictationPostProcess", () => {
  it("sends the chosen style to the cleanup, and skips it when off or hands-free", async () => {
    const sent: SpeechPostProcessingOptions[] = [];
    const cleanup = vi.fn(
      async (transcript: string, _draft: unknown, options: SpeechPostProcessingOptions) => {
        sent.push(options);
        return `${transcript}!`;
      },
    );
    let style = DEFAULT_DICTATION_STYLE;
    let handsFree = false;
    const postProcess = createDictationPostProcess({
      getStyle: () => style,
      handsFree: () => handsFree,
      cleanup,
    });

    expect(await postProcess("hi", { signal, draft })).toBe("hi!");
    expect(sent[0]?.speechPostProcessingPrompt.mode).toBe("custom");
    expect(sent[0]?.speechPostProcessingPrompt.customInstructions).toContain(
      "Keep the speaker's changes of mind",
    );

    handsFree = true;
    expect(postProcess("hi", { signal, draft })).toBeNull();
    handsFree = false;
    style = { ...DEFAULT_DICTATION_STYLE, aiCleanup: false };
    expect(postProcess("hi", { signal, draft })).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
