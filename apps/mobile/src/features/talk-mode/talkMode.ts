import type { ReadAloudOutcome } from "../read-aloud/readAloudPlayer";
import type { TalkModeNote } from "../../state/thread-outbox";
import type { TalkAnswer, TalkReply } from "./talkAnswer";

/**
 * Talk mode: listen until a pause, send (the outbox adds the short-spoken-answer note), read the
 * answer to that message aloud, listen again. Anything that ends a step early ends talk mode, so
 * the microphone never turns on unless the loop is on screen.
 */

export type TalkModePhase = "listening" | "sending" | "waiting" | "speaking";

/** The thread screen on display, as its composer reports it. */
export interface TalkSeat {
  readonly key: string;
  readonly threadId: string;
  readonly draftKey: string;
  readonly isDraft: boolean;
  readonly canSend: boolean;
  /** Replies can be read aloud here (a direct connection to the PC's voice). */
  readonly canSpeak: boolean;
  /** An approval waits, or a queued message is open for editing: a send would act on that. */
  readonly needsYou: boolean;
  readonly busy: boolean;
  /** Connected to the thread's environment, so its run's progress keeps arriving. */
  readonly connected: boolean;
  /** How the run for the state's `messageId` stands, as this screen sees it. */
  readonly answer: TalkAnswer | null;
  /** Sends the draft, unless `cancelled()` at any point before it is queued. */
  readonly send: (cancelled: () => boolean) => Promise<void>;
  /** `live`: the reply is still being written, and `continueSpeaking` brings the rest. */
  readonly speak: (
    reply: TalkReply,
    onEnd: (outcome: ReadAloudOutcome) => void,
    live: boolean,
  ) => void;
  readonly continueSpeaking: (reply: TalkReply, done: boolean) => void;
}

export interface TalkModeDependencies {
  readonly listen: (
    draftKey: string,
    events: { readonly onCommitted: () => void; readonly onEnded: () => void },
  ) => void;
  readonly stopListening: (draftKey: string) => void;
  readonly stopSpeaking: () => void;
  readonly readDraft: (draftKey: string) => string;
  /** No text or attachments waiting in the draft. */
  readonly draftIsEmpty: (draftKey: string) => boolean;
  /** The next message queued to the note's thread with its text carries the note; null disarms. */
  readonly armNote: (note: TalkModeNote | null) => void;
  /** Explains that replies can't be read aloud on this connection. */
  readonly cannotSpeak: () => void;
  readonly keepAwake: () => () => void;
}

export interface TalkModeState {
  readonly phase: TalkModePhase;
  readonly draftKey: string;
  readonly seatKey: string | null;
  /** The message sent, while waiting for its answer. */
  readonly messageId: string | null;
}

/**
 * How long a step waits for its thread screen (the draft opening, or turning into the thread),
 * or for an idle thread to pick up what was sent.
 */
export const TALK_SEAT_WAIT_MS = 10_000;

/** Live speech starts once the answer has a finished sentence: one with more text after it. */
const FINISHED_SENTENCE = /[.!?…]["'”’)\]*_]*\s+\S/;

export class TalkMode {
  private readonly dependencies: TalkModeDependencies;
  private state: TalkModeState | null = null;
  private seat: TalkSeat | null = null;
  private attachedIsDraft = false;
  /**
   * A sent draft's screen went away; only this key may pick it up. A draft's composer and its
   * thread's composer share the scoped thread key, so this is the thread screen that replaces it.
   */
  private handoffKey: string | null = null;
  private sending = false;
  /** The send reached the outbox; only then may its draft's screen hand off. */
  private queued = false;
  /** Listening waits for its composer, so the microphone never starts behind another screen. */
  private micPending = false;
  /** What the last dictation put in the draft: exactly what gets sent. */
  private said = "";
  private generation = 0;
  /** The answer being read while it's still written, until its last words reach the reader. */
  private live: { readonly replyId: string; done: boolean } | null = null;
  /** An answer whose live reading failed: it is read from the start once it's done. */
  private notLive: string | null = null;
  /** Ignores how a reading ended once talk mode dropped it itself. */
  private reading = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private releaseKeepAwake: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(dependencies: TalkModeDependencies) {
    this.dependencies = dependencies;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): TalkModeState | null => this.state;

  /** Listening, with the microphone started (not still waiting for its composer). */
  readonly isRecording = (): boolean => this.state?.phase === "listening" && !this.micPending;

  /** Starts listening into `draftKey`; its composer may still be opening. */
  start(draftKey: string): void {
    this.stop();
    this.releaseKeepAwake = this.dependencies.keepAwake();
    const seat = this.seat?.draftKey === draftKey ? this.seat : null;
    this.attachedIsDraft = seat?.isDraft ?? false;
    this.listen(draftKey, seat?.key ?? null);
  }

  stop(): void {
    this.end(true);
  }

  private end(stopReply: boolean, stopListening = true): void {
    const state = this.state;
    if (!state) return;
    this.generation += 1;
    this.reading += 1;
    this.live = null;
    this.notLive = null;
    this.clearTimer();
    if (this.sending) this.dependencies.armNote(null);
    this.sending = false;
    this.queued = false;
    this.handoffKey = null;
    this.state = null;
    if (state.phase === "listening" && stopListening && !this.micPending)
      this.dependencies.stopListening(state.draftKey);
    this.micPending = false;
    if (state.phase === "speaking" && stopReply) this.dependencies.stopSpeaking();
    this.releaseKeepAwake?.();
    this.releaseKeepAwake = null;
    this.publish();
  }

  updateSeat(seat: TalkSeat): void {
    this.seat = seat;
    const state = this.state;
    if (!state) return;
    if (state.seatKey === seat.key) {
      this.attachedIsDraft = seat.isDraft;
      this.advance();
      return;
    }
    const attach =
      state.seatKey === null &&
      (this.handoffKey === null ? seat.draftKey === state.draftKey : seat.key === this.handoffKey);
    if (!attach) {
      // Another thread came on screen.
      if (state.seatKey !== null || this.handoffKey !== null) this.stop();
      return;
    }
    this.clearTimer();
    this.handoffKey = null;
    this.attachedIsDraft = seat.isDraft;
    this.setState({ ...state, seatKey: seat.key });
    if (state.phase === "listening" && this.micPending) {
      this.micPending = false;
      this.startMic(state.draftKey);
    }
    this.advance();
  }

  releaseSeat(key: string): void {
    if (this.seat?.key === key) this.seat = null;
    const state = this.state;
    if (!state || state.seatKey !== key) return;
    const sent = (state.phase === "sending" && this.queued) || state.phase === "waiting";
    if (this.attachedIsDraft && sent) {
      // A draft that was sent becomes its thread's screen.
      this.handoffKey = key;
      this.setState({ ...state, seatKey: null });
      this.startTimer();
      return;
    }
    this.stop();
  }

  private listen(draftKey: string, seatKey: string | null): void {
    this.setState({ phase: "listening", draftKey, seatKey, messageId: null });
    if (seatKey !== null) return this.startMic(draftKey);
    this.micPending = true;
    this.startTimer();
  }

  private startMic(draftKey: string): void {
    const generation = this.generation;
    this.dependencies.listen(draftKey, {
      onCommitted: () => {
        if (generation !== this.generation || this.state?.phase !== "listening") return;
        this.said = this.dependencies.readDraft(draftKey).trim();
        this.setState({ ...this.state, phase: "sending" });
        this.advance();
      },
      // The dictation already ended, so leave its error, such as a refused microphone, on show.
      onEnded: () => {
        if (generation === this.generation && this.state?.phase === "listening") {
          this.end(true, false);
        }
      },
    });
  }

  private advance(): void {
    const state = this.state;
    const seat = this.seat;
    if (!state || !seat || state.seatKey !== seat.key) return;
    if (state.phase === "sending") this.send(state, seat);
    else if (state.phase === "waiting" || (state.phase === "speaking" && this.live?.done === false))
      this.awaitAnswer(state, seat);
  }

  private send(state: TalkModeState, seat: TalkSeat): void {
    if (seat.needsYou && !this.sending) return this.stop();
    if (this.sending || !seat.canSend || seat.draftKey !== state.draftKey) {
      if (!this.sending && this.timer === null) this.startTimer();
      return;
    }
    const said = this.said;
    const unchanged = () => this.dependencies.readDraft(state.draftKey).trim() === said;
    // Anything typed while the send waited makes it a typed message, left for a manual send.
    if (!unchanged()) return this.stop();
    // A reply nobody can hear would end the loop after the send; what was said stays in the draft.
    if (!seat.canSpeak) {
      this.stop();
      return this.dependencies.cannotSpeak();
    }
    this.clearTimer();
    this.sending = true;
    this.queued = false;
    const generation = this.generation;
    const current = () => generation === this.generation;
    const fail = () => {
      if (current()) this.stop();
    };
    this.dependencies.armNote({
      threadId: seat.threadId,
      text: said,
      onQueued: (messageId, saved) => {
        if (current()) this.queued = true;
        saved.then(() => {
          if (!current() || !this.state) return;
          this.sending = false;
          this.setState({ ...this.state, phase: "waiting", messageId });
          this.advance();
        }, fail);
      },
    });
    seat
      .send(() => !current() || !unchanged() || this.seat?.needsYou === true)
      .then(() => {
        if (!this.queued) fail();
      }, fail);
  }

  private awaitAnswer(waitingState: TalkModeState, seat: TalkSeat): void {
    let state = waitingState;
    const answer = seat.answer;
    if (answer?.kind === "none" && answer.messageId === state.messageId) return this.stop();
    if (seat.needsYou) return this.stop();
    const reply =
      (answer?.kind === "ready" || answer?.kind === "partial") &&
      answer.messageId === state.messageId
        ? answer.reply
        : null;
    const done = answer?.kind === "ready";
    const live = this.live;
    if (live && reply?.id === live.replyId) {
      if (!live.done) seat.continueSpeaking(reply, done);
      if (done) {
        live.done = true;
        this.setState({ ...state, messageId: null });
      }
      return;
    }
    if (live) {
      // What was read turned out to be progress (a tool call followed it) or an earlier draft.
      this.reading += 1;
      this.live = null;
      this.dependencies.stopSpeaking();
      state = { ...state, phase: "waiting" };
      this.setState(state);
    }
    const speakable =
      reply !== null &&
      (done || (reply.id !== this.notLive && FINISHED_SENTENCE.test(reply.markdown)));
    if (!reply || !speakable) {
      // Waits as long as its run is going, or is queued behind another run. Anything else (an
      // outbox holding it, a cancelled queue entry, a silent end, a lost connection) gives up.
      const going =
        answer?.kind === "pending" ||
        answer?.kind === "partial" ||
        (answer?.kind === "queued" && seat.busy);
      if (seat.connected && going) this.clearTimer();
      else if (this.timer === null) this.startTimer();
      return;
    }
    this.clearTimer();
    const reading = (this.reading += 1);
    this.live = done ? null : { replyId: reply.id, done: false };
    this.setState({ ...state, phase: "speaking", messageId: done ? null : state.messageId });
    seat.speak(reply, (outcome) => this.spoken(reading, reply.id, outcome), !done);
  }

  private spoken(reading: number, replyId: string, outcome: ReadAloudOutcome): void {
    const state = this.state;
    if (reading !== this.reading || state?.phase !== "speaking") return;
    const live = this.live;
    this.live = null;
    if (outcome === "failed" && live && !live.done && state.messageId !== null) {
      // The live reading broke off (the PC lost the thread of the text): read it again once done.
      this.notLive = replyId;
      this.setState({ ...state, phase: "waiting" });
      return this.advance();
    }
    // A reply stopped by hand, replaced by another, or with nothing to say ends it.
    if (outcome !== "finished") return this.end(false);
    const next = this.seat;
    const draftKey = next?.draftKey ?? state.draftKey;
    // Dictation would add to anything typed meanwhile and send it all.
    if (!this.dependencies.draftIsEmpty(draftKey) || next?.needsYou) return this.end(false);
    this.listen(draftKey, next?.key ?? null);
  }

  private startTimer(): void {
    this.clearTimer();
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation === this.generation) this.stop();
    }, TALK_SEAT_WAIT_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private setState(state: TalkModeState): void {
    this.state = state;
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}
