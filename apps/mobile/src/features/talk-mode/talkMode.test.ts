import { TALK_MODE_INSTRUCTION } from "@t3tools/shared/composerContextReferences";
import { describe, expect, it, vi } from "vite-plus/test";

import type { TalkModeNote } from "../../state/thread-outbox";
import type { ReadAloudOutcome } from "../read-aloud/readAloudPlayer";
import { TALK_SEAT_WAIT_MS, TalkMode, type TalkSeat } from "./talkMode";
import { PENDING, QUEUED, SILENT, UNANSWERED, type TalkAnswer, type TalkReply } from "./talkAnswer";

function setup() {
  const drafts = new Map<string, string>();
  const heard: Array<{ draftKey: string; onCommitted: () => void; onEnded: () => void }> = [];
  const spoken: Array<{
    reply: TalkReply;
    onEnd: (outcome: ReadAloudOutcome) => void;
    live: boolean;
  }> = [];
  const continued: Array<{ markdown: string; done: boolean }> = [];
  const releaseKeepAwake = vi.fn();
  let armed: TalkModeNote | null = null;
  const dependencies = {
    listen: vi.fn((draftKey: string, events: { onCommitted: () => void; onEnded: () => void }) => {
      heard.push({ draftKey, ...events });
    }),
    stopListening: vi.fn(),
    stopSpeaking: vi.fn(),
    readDraft: (draftKey: string) => drafts.get(draftKey) ?? "",
    draftIsEmpty: (draftKey: string) => (drafts.get(draftKey) ?? "") === "",
    armNote: (note: TalkModeNote | null) => void (armed = note),
    cannotSpeak: vi.fn(),
    keepAwake: vi.fn(() => releaseKeepAwake),
  };
  const talk = new TalkMode(dependencies);
  const sent: string[] = [];
  let saved: Promise<void> = Promise.resolve();
  /** Mirrors the outbox: a matching armed note goes on the message and hears it queued. */
  const enqueue = (threadId: string, text: string, write: Promise<void>) => {
    const messageId = `m${sent.length + 1}`;
    const note = armed;
    if (note !== null && note.threadId === threadId && note.text === text) {
      armed = null;
      sent.push(`${TALK_MODE_INSTRUCTION}${text}`);
      note.onQueued(messageId, write);
    } else sent.push(text);
    saved = write;
  };
  const seat = (
    overrides: Partial<TalkSeat> & Pick<TalkSeat, "key" | "draftKey"> & { write?: Promise<void> },
  ): TalkSeat => ({
    threadId: "t1",
    isDraft: false,
    canSend: true,
    canSpeak: true,
    needsYou: false,
    busy: false,
    connected: true,
    answer: null,
    send: async (cancelled) => {
      if (cancelled()) return;
      enqueue(
        overrides.threadId ?? "t1",
        drafts.get(overrides.draftKey) ?? "",
        overrides.write ?? Promise.resolve(),
      );
      drafts.set(overrides.draftKey, "");
    },
    speak: (reply, onEnd, live) => void spoken.push({ reply, onEnd, live }),
    continueSpeaking: (reply, done) => void continued.push({ markdown: reply.markdown, done }),
    ...overrides,
  });
  /** What was said lands in the draft, as the dictation commits it. */
  const say = (text: string) => {
    const listening = heard.at(-1)!;
    drafts.set(listening.draftKey, text);
    listening.onCommitted();
  };
  const phase = () => talk.getState()?.phase ?? "off";
  return {
    talk,
    dependencies,
    drafts,
    heard,
    spoken,
    continued,
    sent,
    seat,
    say,
    phase,
    releaseKeepAwake,
    armed: () => armed,
    /** Settles once talk mode has seen the outbox write finish. */
    saved: () => saved.catch(() => {}),
  };
}

const ready = (messageId: string, id: string): TalkAnswer => ({
  kind: "ready",
  messageId,
  reply: { id, markdown: `Reply ${id}.` },
});

const partial = (messageId: string, id: string, markdown: string): TalkAnswer => ({
  kind: "partial",
  messageId,
  reply: { id, markdown },
});

describe("talk mode", () => {
  it("listens, sends with the spoken-reply note, reads the answer, then listens again", async () => {
    const t = setup();
    t.talk.start("draft:1");
    // The microphone waits for the draft's composer, not whichever screen is up.
    t.talk.updateSeat(t.seat({ key: "env:t0", draftKey: "env:t0" }));
    expect(t.heard).toEqual([]);
    // A draft's screen and its thread's screen share the thread's key.
    const draft = t.seat({ key: "env:t1", draftKey: "draft:1", isDraft: true, canSend: false });
    t.talk.updateSeat(draft);
    expect(t.heard.map((h) => h.draftKey)).toEqual(["draft:1"]);

    t.say("Is the build done?");
    expect(t.sent).toEqual([]);
    t.talk.updateSeat({ ...draft, canSend: true });
    expect(t.sent).toEqual([`${TALK_MODE_INSTRUCTION}Is the build done?`]);
    await t.saved();
    expect(t.talk.getState()).toMatchObject({ phase: "waiting", messageId: "m1" });

    t.talk.releaseSeat("env:t1");
    const thread = t.seat({ key: "env:t1", draftKey: "env:t1", busy: true, answer: PENDING });
    t.talk.updateSeat(thread);
    expect(t.spoken).toEqual([]);
    // Its run is done even though the thread went straight on to another device's message.
    t.talk.updateSeat({ ...thread, answer: ready("m1", "a1") });
    expect(t.spoken.map((s) => s.reply.id)).toEqual(["a1"]);
    expect(t.talk.getState()).toMatchObject({ phase: "speaking", messageId: null });

    t.spoken[0]!.onEnd("finished");
    expect(t.phase()).toBe("listening");
    expect(t.heard.map((h) => h.draftKey)).toEqual(["draft:1", "env:t1"]);
    expect(t.releaseKeepAwake).not.toHaveBeenCalled();

    // Once it is the thread's own screen, opening another thread ends it.
    t.say("Thanks");
    await t.saved();
    t.talk.updateSeat(
      t.seat({ key: "env:t2", draftKey: "env:t2", threadId: "t2", answer: ready("m2", "b1") }),
    );
    expect(t.phase()).toBe("off");
    expect(t.spoken).toHaveLength(1);
  });

  it("reads the answer while it's written, from its first finished sentence", async () => {
    const t = setup();
    const thread = t.seat({ key: "env:t1", draftKey: "env:t1", busy: true });
    t.talk.updateSeat(thread);
    t.talk.start("env:t1");
    t.say("Did the build pass?");
    await t.saved();
    vi.useFakeTimers();
    try {
      t.talk.updateSeat({ ...thread, answer: partial("m1", "a1", "The build") });
      vi.advanceTimersByTime(TALK_SEAT_WAIT_MS);
      expect(t.spoken).toEqual([]);
      expect(t.phase()).toBe("waiting");
    } finally {
      vi.useRealTimers();
    }

    t.talk.updateSeat({ ...thread, answer: partial("m1", "a1", "The build passed. All") });
    expect(t.spoken.map((s) => s.live)).toEqual([true]);
    expect(t.talk.getState()).toMatchObject({ phase: "speaking", messageId: "m1" });
    t.talk.updateSeat({
      ...thread,
      answer: partial("m1", "a1", "The build passed. All tests ran."),
    });
    t.talk.updateSeat({ ...thread, answer: ready("m1", "a1") });
    expect(t.continued).toEqual([
      { markdown: "The build passed. All tests ran.", done: false },
      { markdown: "Reply a1.", done: true },
    ]);
    expect(t.talk.getState()).toMatchObject({ phase: "speaking", messageId: null });
    // Once its last words went out, nothing on screen drops the reading.
    t.talk.updateSeat({ ...thread, answer: null });
    expect(t.dependencies.stopSpeaking).not.toHaveBeenCalled();

    t.spoken[0]!.onEnd("finished");
    expect(t.phase()).toBe("listening");
    expect(t.spoken).toHaveLength(1);
  });

  it("drops a reading that turns out to be progress, then reads the real answer", async () => {
    const t = setup();
    const thread = t.seat({ key: "env:t1", draftKey: "env:t1", busy: true });
    t.talk.updateSeat(thread);
    t.talk.start("env:t1");
    t.say("Check the logs");
    await t.saved();
    t.talk.updateSeat({ ...thread, answer: partial("m1", "a0", "Let me look. Opening") });
    expect(t.spoken.map((s) => s.live)).toEqual([true]);

    // A tool call followed, so those words were progress.
    t.talk.updateSeat({ ...thread, answer: PENDING });
    expect(t.dependencies.stopSpeaking).toHaveBeenCalledTimes(1);
    t.spoken[0]!.onEnd("stopped");
    expect(t.talk.getState()).toMatchObject({ phase: "waiting", messageId: "m1" });

    t.talk.updateSeat({ ...thread, answer: ready("m1", "a1") });
    expect(t.spoken.map((s) => [s.reply.id, s.live])).toEqual([
      ["a0", true],
      ["a1", false],
    ]);
  });

  it("reads the answer from the start once it's done when the live reading fails", async () => {
    const t = setup();
    const thread = t.seat({ key: "env:t1", draftKey: "env:t1", busy: true });
    t.talk.updateSeat(thread);
    t.talk.start("env:t1");
    t.say("Summarize it");
    await t.saved();
    t.talk.updateSeat({ ...thread, answer: partial("m1", "a1", "It works. Mostly") });
    t.spoken[0]!.onEnd("failed");
    expect(t.phase()).toBe("waiting");

    t.talk.updateSeat({ ...thread, answer: partial("m1", "a1", "It works. Mostly fine.") });
    expect(t.spoken).toHaveLength(1);
    t.talk.updateSeat({ ...thread, answer: ready("m1", "a1") });
    expect(t.spoken.map((s) => s.live)).toEqual([true, false]);
  });

  it("ignores an answer to another message", async () => {
    const t = setup();
    const thread = t.seat({ key: "env:t1", draftKey: "env:t1" });
    t.talk.updateSeat(thread);
    t.talk.start("env:t1");
    t.say("And then?");
    await t.saved();
    t.talk.updateSeat({ ...thread, answer: ready("m0", "old") });
    expect(t.spoken).toEqual([]);
    expect(t.phase()).toBe("waiting");
  });

  it("ends when the run ends without an answer, nobody picks it up, or the connection drops", async () => {
    const t = setup();
    const thread = t.seat({ key: "env:t1", draftKey: "env:t1" });
    t.talk.updateSeat(thread);
    t.talk.start("env:t1");
    t.say("Interrupt me");
    await t.saved();
    t.talk.updateSeat({ ...thread, answer: { kind: "none", messageId: "m1" } });
    expect(t.phase()).toBe("off");

    vi.useFakeTimers();
    try {
      t.talk.start("env:t1");
      t.say("Hello?");
      await t.saved();
      t.talk.updateSeat({ ...thread, answer: QUEUED, busy: true });
      vi.advanceTimersByTime(TALK_SEAT_WAIT_MS);
      expect(t.phase()).toBe("waiting");
      t.talk.updateSeat({ ...thread, answer: QUEUED });
      vi.advanceTimersByTime(TALK_SEAT_WAIT_MS);
      expect(t.phase()).toBe("off");

      // Cancelled from the queue on another device, while the thread stays busy.
      t.talk.start("env:t1");
      t.say("Hello again?");
      await t.saved();
      t.talk.updateSeat({ ...thread, answer: UNANSWERED, busy: true });
      vi.advanceTimersByTime(TALK_SEAT_WAIT_MS);
      expect(t.phase()).toBe("off");

      // Its run ended silently while another device's turn keeps the thread busy.
      t.talk.start("env:t1");
      t.say("Anything?");
      await t.saved();
      t.talk.updateSeat({ ...thread, answer: SILENT, busy: true });
      vi.advanceTimersByTime(TALK_SEAT_WAIT_MS);
      expect(t.phase()).toBe("off");

      // The connection dropped mid-run, so the run's progress stopped arriving.
      t.talk.start("env:t1");
      t.say("Still there?");
      await t.saved();
      t.talk.updateSeat({ ...thread, answer: PENDING, connected: false });
      vi.advanceTimersByTime(TALK_SEAT_WAIT_MS);
      expect(t.phase()).toBe("off");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["nothing is said", (t: ReturnType<typeof setup>) => t.heard[0]!.onEnded()],
    [
      "another thread comes on screen",
      (t: ReturnType<typeof setup>) =>
        t.talk.updateSeat(t.seat({ key: "env:t2", draftKey: "env:t2" })),
    ],
    ["the thread screen goes away", (t: ReturnType<typeof setup>) => t.talk.releaseSeat("env:t1")],
  ])("turns off when %s", (_case, act) => {
    const t = setup();
    t.talk.updateSeat(t.seat({ key: "env:t1", draftKey: "env:t1" }));
    t.talk.start("env:t1");
    act(t);
    expect(t.phase()).toBe("off");
    expect(t.releaseKeepAwake).toHaveBeenCalledOnce();
  });

  it.each([
    ["the reply is stopped", "stopped"],
    ["the reply has nothing to say", "empty"],
    ["something was typed meanwhile", "finished"],
  ] as const)("doesn't listen again when %s", async (_case, outcome) => {
    const t = setup();
    const thread = t.seat({ key: "env:t1", draftKey: "env:t1" });
    t.talk.updateSeat(thread);
    t.talk.start("env:t1");
    t.say("Hi");
    await t.saved();
    t.talk.updateSeat({ ...thread, answer: ready("m1", "a1") });
    t.drafts.set("env:t1", "half a thought");
    t.spoken[0]!.onEnd(outcome);
    expect(t.phase()).toBe("off");
    expect(t.heard).toHaveLength(1);
    expect(t.dependencies.stopSpeaking).not.toHaveBeenCalled();
  });

  it("leaves an approval or a queued edit to the screen", async () => {
    const t = setup();
    const thread = t.seat({ key: "env:t1", draftKey: "env:t1", canSend: false });
    t.talk.updateSeat(thread);
    t.talk.start("env:t1");
    t.say("Go ahead");
    // A queued message opened for editing (its own draft) before the send could go.
    t.talk.updateSeat({ ...thread, draftKey: "edit:q1", needsYou: true });
    t.talk.updateSeat(thread);
    t.talk.updateSeat({ ...thread, canSend: true });
    expect(t.sent).toEqual([]);
    expect(t.phase()).toBe("off");

    t.talk.updateSeat(thread);
    t.talk.start("env:t1");
    t.say("Go ahead");
    // An approval came up: the words would decline it as feedback.
    t.talk.updateSeat({ ...thread, canSend: true, needsYou: true });
    expect(t.sent).toEqual([]);
    expect(t.phase()).toBe("off");
    expect(t.drafts.get("env:t1")).toBe("Go ahead");

    t.drafts.set("env:t1", "");
    t.talk.updateSeat({ ...thread, canSend: true });
    t.talk.start("env:t1");
    t.say("Next?");
    await t.saved();
    t.talk.updateSeat({ ...thread, answer: PENDING, needsYou: true });
    expect(t.phase()).toBe("off");

    t.talk.updateSeat({ ...thread, canSend: true });
    t.talk.start("env:t1");
    t.say("And now?");
    await t.saved();
    t.talk.updateSeat({ ...thread, answer: ready("m2", "a2") });
    // A queued message opened for editing while the reply plays.
    t.talk.updateSeat({ ...thread, needsYou: true });
    t.spoken.at(-1)!.onEnd("finished");
    expect(t.phase()).toBe("off");
    expect(t.heard).toHaveLength(4);
  });

  it("stops the reply when leaving cuts it off", async () => {
    const t = setup();
    const thread = t.seat({ key: "env:t1", draftKey: "env:t1" });
    t.talk.updateSeat(thread);
    t.talk.start("env:t1");
    t.say("Again");
    await t.saved();
    t.talk.updateSeat({ ...thread, answer: ready("m1", "a1") });
    t.talk.releaseSeat("env:t1");
    expect(t.dependencies.stopSpeaking).toHaveBeenCalledOnce();
    expect(t.phase()).toBe("off");
  });

  it("turns off and leaves no note armed when the send doesn't go out or can't be answered aloud", async () => {
    const t = setup();
    const declined = Promise.resolve();
    t.talk.updateSeat(t.seat({ key: "env:t1", draftKey: "env:t1", send: () => declined }));
    t.talk.start("env:t1");
    t.say("Hello?");
    await declined;
    expect(t.phase()).toBe("off");
    expect(t.drafts.get("env:t1")).toBe("Hello?");
    expect(t.armed()).toBeNull();

    const failedWrite = Promise.reject(new Error("disk full"));
    t.talk.updateSeat(t.seat({ key: "env:t1", draftKey: "env:t1", write: failedWrite }));
    t.talk.start("env:t1");
    t.say("Hello again?");
    await t.saved();
    expect(t.phase()).toBe("off");

    t.talk.updateSeat(t.seat({ key: "env:t1", draftKey: "env:t1", canSpeak: false }));
    t.talk.start("env:t1");
    t.say("Can you hear me?");
    expect(t.phase()).toBe("off");
    expect(t.dependencies.cannotSpeak).toHaveBeenCalledOnce();
    expect(t.drafts.get("env:t1")).toBe("Can you hear me?");
    expect(t.armed()).toBeNull();
  });

  it("leaves a typed edit for a manual send, and a dictation's own error on show", () => {
    const t = setup();
    const thread = t.seat({ key: "env:t1", draftKey: "env:t1", canSend: false });
    t.talk.updateSeat(thread);
    t.talk.start("env:t1");
    t.say("Book a table");
    t.drafts.set("env:t1", "Book a table for two");
    t.talk.updateSeat({ ...thread, canSend: true });
    expect(t.sent).toEqual([]);
    expect(t.phase()).toBe("off");
    expect(t.drafts.get("env:t1")).toBe("Book a table for two");

    t.talk.start("env:t1");
    t.heard.at(-1)!.onEnded();
    expect(t.phase()).toBe("off");
    expect(t.dependencies.stopListening).not.toHaveBeenCalled();
  });

  it.each([
    ["the draft is left", (t: ReturnType<typeof setup>) => t.talk.releaseSeat("env:t1")],
    [
      "an approval comes up",
      (t: ReturnType<typeof setup>, seat: TalkSeat) =>
        t.talk.updateSeat({ ...seat, needsYou: true }),
    ],
  ])("doesn't send when %s while the send is getting ready", async (_case, act) => {
    const t = setup();
    let ready!: () => void;
    const settled = new Promise<void>((resolve) => (ready = resolve));
    let sending: Promise<void> | undefined;
    const draft = t.seat({ key: "env:t1", draftKey: "draft:1", isDraft: true });
    const seat = {
      ...draft,
      send: (cancelled: () => boolean) => (sending = settled.then(() => draft.send(cancelled))),
    };
    t.talk.updateSeat(seat);
    t.talk.start("draft:1");
    t.say("Wait for it");
    act(t, seat);
    ready();
    await sending;
    expect(t.sent).toEqual([]);
    expect(t.phase()).toBe("off");
  });

  it("doesn't read a reply that arrives with an approval", async () => {
    const t = setup();
    const thread = t.seat({ key: "env:t1", draftKey: "env:t1" });
    t.talk.updateSeat(thread);
    t.talk.start("env:t1");
    t.say("Deploy it");
    await t.saved();
    t.talk.updateSeat({ ...thread, answer: ready("m1", "a1"), needsYou: true });
    expect(t.spoken).toEqual([]);
    expect(t.phase()).toBe("off");
  });

  it("doesn't send what was said when stopped while the send is getting ready", async () => {
    const t = setup();
    let ready!: () => void;
    const settled = new Promise<void>((resolve) => (ready = resolve));
    let sending: Promise<void> | undefined;
    const thread = t.seat({ key: "env:t1", draftKey: "env:t1" });
    t.talk.updateSeat({
      ...thread,
      send: (cancelled) => (sending = settled.then(() => thread.send(cancelled))),
    });
    t.talk.start("env:t1");
    t.say("Never mind");
    t.talk.stop();
    ready();
    await sending;
    expect(t.sent).toEqual([]);
    expect(t.armed()).toBeNull();
  });

  it("doesn't send from a draft that was left before it could send", () => {
    const t = setup();
    const draft = t.seat({ key: "env:t1", draftKey: "draft:1", isDraft: true, canSend: false });
    t.talk.updateSeat(draft);
    t.talk.start("draft:1");
    t.say("Remind me later");
    t.talk.releaseSeat("env:t1");
    expect(t.phase()).toBe("off");
    t.talk.updateSeat({ ...draft, canSend: true });
    expect(t.sent).toEqual([]);
    expect(t.drafts.get("draft:1")).toBe("Remind me later");
  });

  it("gives up when the draft never opens", () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      t.talk.start("draft:1");
      vi.advanceTimersByTime(TALK_SEAT_WAIT_MS);
      expect(t.phase()).toBe("off");
      expect(t.heard).toEqual([]);
      expect(t.dependencies.stopListening).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
