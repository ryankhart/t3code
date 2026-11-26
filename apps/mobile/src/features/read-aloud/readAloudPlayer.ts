import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { msg } from "gt-react-native";
import { useSyncExternalStore } from "react";
import { markdownToSpeechText } from "@t3tools/shared/speechText";

import * as Dialog from "../../components/ui/Dialog";
import { m } from "../../i18n/messages";
import { createAudioPlaybackSession, disposeAudioPlayer } from "../../lib/audioSession";
import { stripOptionsCodeFences } from "../../lib/markdownOptionsFence";
import { continueSpeech, finishedSentences, requestSpeech } from "./readAloudServer";

/**
 * Plays one reply at a time. The PC turns the whole reply into speech and
 * streams the MP3, so playback starts after about a second however long the
 * reply is. Tapping the same reply again stops it; another reply replaces it.
 * Errors show as a dialog straight away, wherever the person is.
 */

/** The PC server's own limit; longer text is refused before it is sent. */
export const READ_ALOUD_MAX_CHARS = 100_000;

export type ReadAloudStatus = "idle" | "loading" | "playing";

export interface ReadAloudState {
  readonly messageId: string | null;
  readonly status: ReadAloudStatus;
  readonly error: string | null;
}

let state: ReadAloudState = { messageId: null, status: "idle", error: null };
let session = 0;
/** The thread screen the playing reply belongs to, so leaving it stops reading. */
let ownerKey: string | null = null;
let stopCurrent: (() => void) | null = null;
/** How the playing reply ended: played to the end, stopped or replaced, failed, or had no words. */
export type ReadAloudOutcome = "finished" | "stopped" | "failed" | "empty";
let endCurrent: ((outcome: ReadAloudOutcome) => void) | null = null;
const listeners = new Set<() => void>();

function setState(next: ReadAloudState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getReadAloudState(): ReadAloudState {
  return state;
}

export function useReadAloudState(): ReadAloudState {
  return useSyncExternalStore(subscribe, () => state);
}

function takeEnd(): ((outcome: ReadAloudOutcome) => void) | null {
  const end = endCurrent;
  endCurrent = null;
  return end;
}

export function stopReadAloud() {
  finishReadAloud("stopped");
}

function finishReadAloud(outcome: ReadAloudOutcome) {
  const end = takeEnd();
  session += 1;
  const stop = stopCurrent;
  stopCurrent = null;
  stop?.();
  ownerKey = null;
  live = null;
  setState({ messageId: null, status: "idle", error: null });
  end?.(outcome);
}

/** Stops reading if the reply playing belongs to `key` (a thread screen that is going away). */
export function stopReadAloudFor(key: string) {
  if (ownerKey === key && state.status !== "idle") stopReadAloud();
}

/** A reply read while it's still being written: what the PC has so far, sent in order. */
let live: {
  readonly session: number;
  readonly messageId: string;
  readonly serverUrl: string;
  sent: string;
  done: boolean;
  /** Resolves to the PC's id for the speech once the previous update reached it. */
  chain: Promise<string>;
} | null = null;

function fail(current: number, messageId: string, error: unknown) {
  if (current !== session) return;
  // Later failures of the same reading (a live update after the stream broke) stay silent.
  session += 1;
  const end = takeEnd();
  const stop = stopCurrent;
  stopCurrent = null;
  stop?.();
  ownerKey = null;
  const quiet = live?.session === current;
  live = null;
  const message = error instanceof Error ? error.message : String(error);
  setState({ messageId, status: "idle", error: message });
  // Live speech that fails is read again from the start once the reply is done, by its caller.
  if (!quiet) Dialog.alert(m(msg("Couldn't read aloud")), message);
  end?.("failed");
}

function speechText(markdown: string): string {
  // The reply's options block shows as buttons, not text, so it isn't read.
  return markdownToSpeechText(stripOptionsCodeFences(markdown));
}

/**
 * Gives a reply started with `live` its latest text. Only finished sentences go to the PC until
 * `done`, so what it already read never changes.
 */
export function continueReadAloud(messageId: string, markdown: string, done: boolean): void {
  const current = live;
  if (!current || current.messageId !== messageId || current.done) return;
  const full = speechText(markdown);
  const text = done ? full : finishedSentences(full);
  if (!done && text.length <= current.sent.length) return;
  current.sent = text;
  current.done = done;
  current.chain = current.chain.then(async (id) => {
    await continueSpeech(current.serverUrl, id, { text, done });
    return id;
  });
  current.chain.catch((error: unknown) => fail(current.session, messageId, error));
}

export async function startReadAloud(input: {
  readonly messageId: string;
  readonly markdown: string;
  readonly serverUrl: string | null;
  readonly voice: string;
  readonly ownerKey?: string | null;
  /** The reply is still being written: read its finished sentences, then the rest as it comes. */
  readonly live?: boolean;
  readonly onEnd?: (outcome: ReadAloudOutcome) => void;
}): Promise<void> {
  stopReadAloud();
  const current = session;
  ownerKey = input.ownerKey ?? null;
  const full = speechText(input.markdown);
  const text = input.live ? finishedSentences(full) : full;
  if (text.length === 0) {
    input.onEnd?.("empty");
    return;
  }
  endCurrent = input.onEnd ?? null;
  if (!input.serverUrl) {
    fail(
      current,
      input.messageId,
      new Error("Read aloud works only over a direct Tailscale connection to your PC."),
    );
    return;
  }
  if (text.length > READ_ALOUD_MAX_CHARS) {
    fail(current, input.messageId, new Error("This reply is too long to read aloud."));
    return;
  }
  setState({ messageId: input.messageId, status: "loading", error: null });
  let player: AudioPlayer | null = null;
  const requested = requestSpeech(input.serverUrl, { text, voice: input.voice, live: input.live });
  if (input.live) {
    live = {
      session: current,
      messageId: input.messageId,
      serverUrl: input.serverUrl,
      sent: text,
      done: false,
      chain: requested.then((speech) => speech.id),
    };
    // Failures surface through the await below; this only stops an unhandled rejection.
    live.chain.catch(() => {});
  }
  try {
    const { url: audioUrl } = await requested;
    if (current !== session) return;
    const created = createAudioPlayer(audioUrl, { updateInterval: 250 });
    player = created;
    // While play() runs, a release comes from its own failure cleanup, which the catch reports.
    let activating = false;
    const playback = createAudioPlaybackSession(created, false, (requested) => {
      // Another player (a video, a voice note, the recorder) took the audio session.
      if (!requested && !activating && current === session && stopCurrent) stopReadAloud();
    });
    let released = false;
    const subscription = created.addListener("playbackStatusUpdate", (status: AudioStatus) => {
      if (current !== session) return;
      if (status.didJustFinish) {
        finishReadAloud("finished");
        return;
      }
      if ("error" in status && typeof status.error === "string" && status.error.length > 0) {
        fail(current, input.messageId, new Error("The audio couldn't be played."));
        return;
      }
      if (status.playing && state.status !== "playing") {
        setState({ messageId: input.messageId, status: "playing", error: null });
      }
    });
    stopCurrent = () => {
      if (released) return;
      released = true;
      subscription.remove();
      playback.pause();
      disposeAudioPlayer(created);
    };
    activating = true;
    try {
      await playback.play();
    } finally {
      activating = false;
    }
    // play() returns quietly when another player (or the recorder) holds the audio session.
    if (current === session && !playback.requested) {
      fail(current, input.messageId, new Error("Another player is using the audio. Try again."));
    }
  } catch (error) {
    if (player && !stopCurrent) disposeAudioPlayer(player);
    fail(current, input.messageId, error);
  }
}
