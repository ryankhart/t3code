import type {
  PreparedVoiceTranscription,
  VoiceDraftSnapshot,
  VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";
import type { SpeechPostProcessingOptions } from "@t3tools/contracts";

import {
  buildDictationCleanupInstructions,
  tidyDictation,
  type DictationStyle,
} from "./dictationStyle";

/** Applies the instant quick fixes to every transcript the engine returns. */
export function withDictationTidy(
  transcriber: VoiceTranscriber,
  getStyle: () => DictationStyle,
): VoiceTranscriber {
  const tidy = (text: string) => tidyDictation(text, getStyle());
  return {
    prepare: async (options) => {
      const prepared = await transcriber.prepare(options);
      const start = prepared.start;
      const wrapped: PreparedVoiceTranscription = {
        // A getter, because environment transcribers learn their locale after preparing.
        get locale() {
          return prepared.locale;
        },
        transcribe: async (uri, transcribeOptions) =>
          tidy(await prepared.transcribe(uri, transcribeOptions)),
        ...(start
          ? {
              start: async (uri: string, startOptions: { readonly signal: AbortSignal }) => {
                const text = await start(uri, startOptions);
                return text === null ? null : tidy(text);
              },
            }
          : {}),
        ...(prepared.streaming ? { streaming: prepared.streaming } : {}),
      };
      return wrapped;
    },
  };
}

export function dictationCleanupOptions(style: DictationStyle): SpeechPostProcessingOptions {
  return {
    speechCustomWords: [],
    speechPostProcessingPrompt: {
      mode: "custom",
      customInstructions: buildDictationCleanupInstructions(style),
    },
  };
}

/**
 * The AI cleanup step: null skips it (turned off, hands-free talk mode, or no PC connected), so
 * the quick-fixed transcript goes in as it is.
 */
export function createDictationPostProcess(input: {
  readonly getStyle: () => DictationStyle;
  readonly handsFree: () => boolean;
  readonly cleanup: (
    transcript: string,
    draft: VoiceDraftSnapshot,
    options: SpeechPostProcessingOptions,
    signal: AbortSignal,
  ) => Promise<string> | null;
}) {
  return (
    transcript: string,
    options: { readonly signal: AbortSignal; readonly draft: VoiceDraftSnapshot },
  ): Promise<string> | null => {
    const style = input.getStyle();
    if (!style.aiCleanup || input.handsFree()) return null;
    return input.cleanup(transcript, options.draft, dictationCleanupOptions(style), options.signal);
  };
}
