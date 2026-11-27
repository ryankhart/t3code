import { describe, expect, it } from "vite-plus/test";

import {
  buildDictationCleanupInstructions,
  DEFAULT_DICTATION_STYLE,
  parseDictationStyle,
  resolveDictationStyle,
  tidyDictation,
} from "./dictationStyle";

const tidy = (text: string, overrides: Partial<typeof DEFAULT_DICTATION_STYLE> = {}) =>
  tidyDictation(text, { ...DEFAULT_DICTATION_STYLE, ...overrides });

describe("tidyDictation", () => {
  it("joins a sentence the engine broke at a thinking pause", () => {
    expect(tidy("Maybe because it thinks that I raised my? Raised my tone.")).toBe(
      "Maybe because it thinks that I raised my raised my tone.",
    );
    expect(tidy("I want you to. Not stop until it's pushed.")).toBe(
      "I want you to not stop until it's pushed.",
    );
  });

  it("joins one-word lead-ins to what follows", () => {
    expect(tidy("And. Remove the filler words.")).toBe("And remove the filler words.");
    expect(tidy("Also. Make it a toggle.")).toBe("Also, make it a toggle.");
  });

  it("keeps a capital that may belong to a name", () => {
    expect(tidy("Send it to the? Claude app.")).toBe("Send it to the Claude app.");
  });

  it("keeps real questions and drops question marks from statements", () => {
    expect(tidy("Could you try to fix it? Next thing, don't do that?")).toBe(
      "Could you try to fix it? Next thing, don't do that.",
    );
    expect(tidy("So what do we do? That works, right?")).toBe(
      "So what do we do? That works, right?",
    );
    expect(tidy("Can you check it? Don't do that? Is it done?")).toBe(
      "Can you check it? Don't do that. Is it done?",
    );
  });

  it("removes filler words and recapitalizes", () => {
    expect(tidy("Um, could you create a settings panel? Uh, thanks.")).toBe(
      "Could you create a settings panel? Thanks.",
    );
    expect(tidy("Like a? Um. A settings page.")).toBe("Like a a settings page.");
  });

  it("leaves file names and line breaks alone", () => {
    expect(tidy("Open file.ts now.\nThen run it.")).toBe("Open file.ts now.\nThen run it.");
  });

  it("does nothing when every quick fix is off", () => {
    const text = "Raised my? Um. Tone.";
    expect(
      tidy(text, { joinPauseBreaks: false, realQuestionsOnly: false, removeFillers: false }),
    ).toBe(text);
  });
});

describe("buildDictationCleanupInstructions", () => {
  it("keeps changes of mind unless asked to apply them", () => {
    expect(buildDictationCleanupInstructions(DEFAULT_DICTATION_STYLE)).toContain(
      "Keep the speaker's changes of mind",
    );
    expect(
      buildDictationCleanupInstructions({ ...DEFAULT_DICTATION_STYLE, applyChangesOfMind: true }),
    ).toContain("keep only their final version");
  });

  it("includes only the chosen extras", () => {
    const base = buildDictationCleanupInstructions(DEFAULT_DICTATION_STYLE);
    expect(base).not.toContain("backticks");
    expect(base).not.toContain("new paragraph");
    const all = buildDictationCleanupInstructions({
      ...DEFAULT_DICTATION_STYLE,
      codeFormatting: true,
      spokenCommands: true,
      wording: "tighter",
      extraInstructions: "Spell T3 Code with a capital T.",
    });
    expect(all).toContain("backticks");
    expect(all).toContain("new paragraph");
    expect(all).toContain("Tighten wordy phrasing");
    expect(all).toContain("Spell T3 Code with a capital T.");
  });
});

describe("parseDictationStyle", () => {
  it("keeps valid fields and drops the rest", () => {
    expect(
      parseDictationStyle({ timing: "live", aiCleanup: false, wording: "loud", paragraphs: "yes" }),
    ).toEqual({ timing: "live", aiCleanup: false });
    expect(parseDictationStyle("nope")).toBeUndefined();
    expect(resolveDictationStyle({ timing: "live" }).fixGrammar).toBe(true);
  });
});
