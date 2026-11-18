import { View } from "react-native";

import { Notice } from "../../components/ui/Notice";
import { useTranscribingDictation } from "../voice-input/VoiceInputProvider";
import type { TalkModePhase } from "./talkMode";
import { talkMode, useTalkModeState } from "./talkModeRuntime";

const PHASE_MESSAGES: Record<TalkModePhase, string> = {
  listening: "Talk mode: listening. Pause to send.",
  sending: "Talk mode: sending…",
  waiting: "Talk mode: waiting for the reply…",
  speaking: "Talk mode: reading the reply. It listens again after.",
};

/** Shows talk mode on the composer it's working in, with the way out. */
export function TalkModeBar(props: { readonly seatKey: string; readonly draftKey: string }) {
  const state = useTalkModeState();
  const transcribing = useTranscribingDictation();
  if (!state || (state.seatKey !== props.seatKey && state.draftKey !== props.draftKey)) return null;
  const message =
    state.phase === "listening" && transcribing
      ? "Talk mode: writing down what you said…"
      : PHASE_MESSAGES[state.phase];
  return (
    <View className="px-4 pb-2">
      <Notice
        message={message}
        icon={state.phase === "speaking" ? "speaker.wave.2" : "mic"}
        floating
        onDismiss={() => talkMode.stop()}
        dismissLabel="Stop talk mode"
      />
    </View>
  );
}
