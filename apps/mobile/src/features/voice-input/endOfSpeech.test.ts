import { describe, expect, it } from "vite-plus/test";

import { createEndOfSpeechDetector, type EndOfSpeechVerdict } from "./endOfSpeech";

const QUIET = 0.02;
const VOICE = 0.4;

/** Feeds `[level, untilMs]` runs at 80 ms steps and returns the first verdict that isn't "listening". */
function run(segments: ReadonlyArray<readonly [number, number]>) {
  const detect = createEndOfSpeechDetector();
  let ms = 0;
  for (const [level, until] of segments) {
    for (; ms <= until; ms += 80) {
      const verdict: EndOfSpeechVerdict = detect(level, ms);
      if (verdict !== "listening") return { verdict, ms };
    }
  }
  return { verdict: "listening" as const, ms };
}

describe("end of speech", () => {
  it("ends a pause after speech, not a pause mid-sentence", () => {
    expect(
      run([
        [QUIET, 1_000],
        [VOICE, 3_000],
        [QUIET, 4_000],
        [VOICE, 5_000],
        [QUIET, 9_000],
      ]),
    ).toEqual({
      verdict: "finished",
      ms: 6_480,
    });
  });

  it("ignores a click, but not a quick yes", () => {
    expect(
      run([
        [VOICE, 160],
        [QUIET, 20_000],
      ]).verdict,
    ).toBe("no-speech");
    // The metering timer stalled, so one loud reading arrives half a second after the last.
    const detect = createEndOfSpeechDetector();
    for (let ms = 0; ms <= 400; ms += 80) detect(QUIET, ms);
    detect(VOICE, 880);
    let verdict: EndOfSpeechVerdict = "listening";
    for (let ms = 960; ms <= 20_000 && verdict === "listening"; ms += 80) {
      verdict = detect(QUIET, ms);
    }
    expect(verdict).toBe("no-speech");
    expect(
      run([
        [QUIET, 1_000],
        [VOICE, 1_320],
        [QUIET, 20_000],
      ]),
    ).toEqual({ verdict: "finished", ms: 2_800 });
  });

  it("gives up when nothing is said", () => {
    expect(run([[QUIET, 20_000]])).toEqual({ verdict: "no-speech", ms: 15_040 });
  });

  it("keeps listening through a long answer, with its breaths between phrases", () => {
    const phrases = Array.from({ length: 25 }, (_, i) => [
      [VOICE, i * 2_400 + 2_000] as const,
      [QUIET, i * 2_400 + 2_400] as const,
    ]).flat();
    expect(run(phrases).verdict).toBe("listening");
  });

  it("hears speech over steady noise, and doesn't take the noise for speech", () => {
    const NOISE = 0.3;
    expect(run([[NOISE, 20_000]])).toEqual({ verdict: "no-speech", ms: 15_040 });
    // The recorder reports silence until its first audio arrives.
    expect(
      run([
        [0, 0],
        [NOISE, 20_000],
      ]),
    ).toEqual({ verdict: "no-speech", ms: 15_040 });
    expect(
      run([
        [NOISE, 1_000],
        [0.6, 3_000],
        [NOISE, 9_000],
      ]),
    ).toEqual({ verdict: "finished", ms: 4_480 });
  });
});
