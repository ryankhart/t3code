/**
 * Decides when a hands-free recording is over from its metered levels (0–1, see
 * voiceInputMetering) and the recording's own clock, so a paused recorder never runs it out.
 */

/** About -35 dBFS: ordinary speech near the phone, well above a quiet room. */
const SPEECH_LEVEL = 0.15;
/**
 * Speech also has to stand about 6 dB above the quietest level of the last few seconds, so steady
 * noise (a fan, a car) can't count as endless speech. Pauses between phrases keep that low.
 */
const ABOVE_NOISE = 1.4;
const NOISE_WINDOW_MS = 3_000;
/** Speech in total before a pause can end the recording: a quick "yes", but not a click. */
const MIN_SPEECH_MS = 240;
/** One reading's worth of speech, so a late sample after a stalled timer counts as one click. */
const MAX_SAMPLE_MS = 120;
export const END_OF_SPEECH_PAUSE_MS = 1_500;
export const NO_SPEECH_TIMEOUT_MS = 15_000;

export type EndOfSpeechVerdict = "listening" | "finished" | "no-speech";

export function createEndOfSpeechDetector() {
  let speechMs = 0;
  let lastSampleMs: number | null = null;
  let lastSpeechMs: number | null = null;
  const recent: Array<{ readonly level: number; readonly ms: number }> = [];

  return (level: number, recordedMs: number): EndOfSpeechVerdict => {
    const step =
      lastSampleMs === null ? 0 : Math.min(MAX_SAMPLE_MS, Math.max(0, recordedMs - lastSampleMs));
    lastSampleMs = recordedMs;
    // Zero is the recorder before any audio arrives (or below -60 dB), not a quiet moment.
    if (level > 0) recent.push({ level, ms: recordedMs });
    while (recent.length > 0 && recent[0]!.ms < recordedMs - NOISE_WINDOW_MS) recent.shift();
    const noise = recent.length === 0 ? 0 : Math.min(...recent.map((sample) => sample.level));
    if (level >= SPEECH_LEVEL && level > noise * ABOVE_NOISE) {
      speechMs += step;
      lastSpeechMs = recordedMs;
      return "listening";
    }
    if (speechMs >= MIN_SPEECH_MS && lastSpeechMs !== null) {
      return recordedMs - lastSpeechMs >= END_OF_SPEECH_PAUSE_MS ? "finished" : "listening";
    }
    return recordedMs >= NO_SPEECH_TIMEOUT_MS ? "no-speech" : "listening";
  };
}
