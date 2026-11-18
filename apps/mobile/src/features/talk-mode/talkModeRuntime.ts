import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import type { ThreadFeedEntry } from "../../lib/threadActivity";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { armTalkModeNote } from "../../state/thread-outbox";
import { environmentThreadDetails } from "../../state/threads";
import { getComposerDraftSnapshot } from "../../state/use-composer-drafts";
import { stopReadAloud } from "../read-aloud/readAloudPlayer";
import {
  cancelDictation,
  dictateHandsFree,
  isTranscribingDictation,
} from "../voice-input/VoiceInputProvider";
import { TalkMode, type TalkModeState, type TalkSeat } from "./talkMode";
import { talkAnswer, type TalkAnswer } from "./talkAnswer";

let keepAwakeCount = 0;

export const talkMode = new TalkMode({
  listen: (draftKey, events) => dictateHandsFree(draftKey, "Talk mode", events),
  stopListening: cancelDictation,
  stopSpeaking: stopReadAloud,
  readDraft: (draftKey) => getComposerDraftSnapshot(draftKey).text,
  draftIsEmpty: (draftKey) => {
    const draft = getComposerDraftSnapshot(draftKey);
    return draft.text.trim().length === 0 && draft.attachments.length === 0;
  },
  armNote: armTalkModeNote,
  cannotSpeak: () =>
    Dialog.alert(
      "Talk mode can't read replies here",
      "Read aloud works only over a direct Tailscale connection to your PC. What you said is in the message box.",
    ),
  // The conversation shouldn't stop because the screen timed out while the agent worked. Each run
  // gets its own tag so a late release from the last one can't drop this one's.
  keepAwake: () => {
    const tag = `talk-mode-${(keepAwakeCount += 1)}`;
    const activation = activateKeepAwakeAsync(tag);
    void activation.catch(() => {});
    return () => void activation.then(() => deactivateKeepAwake(tag)).catch(() => {});
  },
});

// Leaving the app ends the loop so nothing is sent, played, or recorded out of sight. A live
// recording is left to the recorder, which ends it itself but sits out the permission prompt.
AppState.addEventListener("change", (appState) => {
  if (appState !== "background" || talkMode.getState() === null) return;
  if (!talkMode.isRecording() || isTranscribingDictation()) talkMode.stop();
});

export function useTalkModeState(): TalkModeState | null {
  return useSyncExternalStore(talkMode.subscribe, talkMode.getState);
}

const NO_THREAD_ATOM = Atom.make(null).pipe(Atom.withLabel("mobile-talk-mode-thread:none"));

/** How the run for talk mode's sent message stands on this screen; null when nothing is sent. */
export function useTalkAnswer(
  target: ScopedThreadRef | null,
  feed: ReadonlyArray<ThreadFeedEntry>,
): TalkAnswer | null {
  const messageId = useTalkModeState()?.messageId ?? null;
  const thread = useAtomValue(
    messageId === null || target === null
      ? NO_THREAD_ATOM
      : environmentThreadDetails.quietThreadAtom(target),
  );
  return messageId === null ? null : talkAnswer(feed, thread?.projection.runs ?? null, messageId);
}

/** Reports the composer on screen to talk mode; `seat` is null while its screen isn't focused. */
export function useTalkModeSeat(seat: TalkSeat | null): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the latest send, answer and readiness to the talk mode loop outside React.
  useEffect(() => {
    if (seat) talkMode.updateSeat(seat);
  });
  const key = seat?.key ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the talk mode loop its thread screen went away or lost focus.
  useEffect(() => {
    if (key === null) return;
    return () => talkMode.releaseSeat(key);
  }, [key]);
}
