import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createAssistantLauncher,
  installAssistantLaunch,
  SCRATCH_ENVIRONMENT_WAIT_MS,
} from "./assistantLaunch";

vi.mock("expo", () => ({ requireOptionalNativeModule: vi.fn(() => null) }));

const ENVIRONMENT_ID = EnvironmentId.make("env-pc");
const PROJECT = {
  environmentId: ENVIRONMENT_ID,
  id: ProjectId.make("scratch"),
  title: "No project",
} as EnvironmentProject;

type LauncherEnvironment = Parameters<typeof createAssistantLauncher>[0];

function setup(overrides: Partial<LauncherEnvironment> = {}) {
  const events: string[] = [];
  let loadDrafts: () => void = () => undefined;
  const drafts = new Promise<void>((resolve) => {
    loadDrafts = resolve;
  });
  // What the phone knows: a gesture waiting to be taken, whether the user is still in the app,
  // and the environment that has connected.
  const phone = {
    gesturePending: false,
    inApp: true,
    transcribing: false,
    environmentId: null as EnvironmentId | null,
    // Another environment is still connecting, so connections have not settled.
    othersConnecting: false,
  };
  let onAssist: () => void = () => undefined;
  let onEnvironment: () => void = () => undefined;
  const remove = vi.fn();
  const environment: LauncherEnvironment = {
    assistant: {
      takeLaunch: () => {
        const taken = phone.gesturePending;
        phone.gesturePending = false;
        return taken;
      },
      isLaunchCurrent: () => phone.inApp,
      addListener: (_event, listener) => {
        onAssist = listener;
        return { remove };
      },
    },
    linkTo: (href) => events.push(`link ${href}`),
    isTranscribing: () => phone.transcribing,
    scratchEnvironmentId: (when) =>
      when === "settled" && phone.othersConnecting ? null : phone.environmentId,
    onScratchEnvironmentChange: (listener) => {
      onEnvironment = listener;
      return () => events.push("stop watching connections");
    },
    showConnecting: () => {
      events.push("show connecting");
      return () => events.push("hide connecting");
    },
    startNoProjectThread: async (environmentId, open) => {
      events.push(`start ${environmentId}`);
      open(PROJECT);
    },
    draftsLoaded: () => drafts.then(() => true),
    dictationReady: async () => {
      events.push("dictation ready");
    },
    createDraft: () => "draft:1",
    dictate: (draftKey) => events.push(`dictate ${draftKey}`),
    ...overrides,
  };
  return {
    events,
    phone,
    loadDrafts,
    environment,
    remove,
    launch: createAssistantLauncher(environment),
    connect: () => {
      phone.environmentId = ENVIRONMENT_ID;
      onEnvironment();
    },
    gesture: () => {
      phone.gesturePending = true;
      onAssist();
    },
  };
}

const WAITED = ["show connecting", "stop watching connections", "hide connecting"];
const OPENED = [
  "start env-pc",
  "dictation ready",
  "link /new/draft?draftId=draft%3A1&title=No%20project",
  "dictate draft:1",
];

describe("createAssistantLauncher", () => {
  it("opens a No project draft and dictates into it", async () => {
    const launcher = setup();
    launcher.phone.environmentId = ENVIRONMENT_ID;
    launcher.loadDrafts();
    await launcher.launch();
    expect(launcher.events).toEqual(OPENED);
  });

  it("waits for the environment to connect when the gesture started the app", async () => {
    const launcher = setup();
    launcher.loadDrafts();
    const launched = launcher.launch();
    expect(launcher.events).toEqual(["show connecting"]);
    launcher.connect();
    await launched;
    expect(launcher.events).toEqual([...WAITED, ...OPENED]);
  });

  it.each([
    {
      name: "opens the new-thread screen when no environment connects in time",
      connected: false,
      expected: [...WAITED, "link /new"],
    },
    {
      name: "uses the connected environment when another is still connecting after the wait",
      connected: true,
      expected: [...WAITED, ...OPENED],
    },
  ])("$name", async ({ connected, expected }) => {
    vi.useFakeTimers();
    try {
      const launcher = setup();
      launcher.phone.othersConnecting = true;
      if (connected) launcher.phone.environmentId = ENVIRONMENT_ID;
      launcher.loadDrafts();
      const launched = launcher.launch();
      await vi.advanceTimersByTimeAsync(SCRATCH_ENVIRONMENT_WAIT_MS);
      await launched;
      expect(launcher.events).toEqual(expected);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      name: "leaves a transcript that is on its way alone",
      overrides: { isTranscribing: () => true },
      expected: [],
    },
    {
      name: "opens nothing when saved drafts could not be read",
      overrides: { draftsLoaded: async () => false },
      expected: ["start env-pc", "dictation ready"],
    },
  ])("$name", async ({ overrides, expected }) => {
    const launcher = setup(overrides);
    launcher.phone.environmentId = ENVIRONMENT_ID;
    await launcher.launch();
    expect(launcher.events).toEqual(expected);
  });

  it.each([
    { name: "an environment connects", connected: false, expected: WAITED },
    {
      name: "saved drafts load",
      connected: true,
      expected: ["start env-pc", "dictation ready"],
    },
  ])(
    "never opens or records once the user left the app before $name",
    async ({ connected, expected }) => {
      const launcher = setup();
      if (connected) launcher.phone.environmentId = ENVIRONMENT_ID;
      const launched = launcher.launch();
      await Promise.resolve();
      launcher.phone.inApp = false;
      launcher.connect();
      launcher.loadDrafts();
      await launched;
      expect(launcher.events).toEqual(expected);
    },
  );

  it.each([
    { name: "an environment connects", connected: false, expected: [...WAITED, ...OPENED] },
    { name: "saved drafts load", connected: true, expected: OPENED },
  ])("starts one thread when the gesture repeats before $name", async ({ connected, expected }) => {
    const launcher = setup();
    if (connected) launcher.phone.environmentId = ENVIRONMENT_ID;
    const first = launcher.launch();
    await Promise.resolve();
    const second = launcher.launch();
    launcher.connect();
    launcher.loadDrafts();
    await Promise.all([first, second]);
    expect(launcher.events).toEqual(expected);
  });
});

describe("installAssistantLaunch", () => {
  it("launches once per gesture, including the one that started the app", () => {
    // The launcher asks this first, synchronously, so each call is one launch.
    const isTranscribing = vi.fn(() => true);
    const launcher = setup({ isTranscribing });
    launcher.phone.gesturePending = true;
    const dispose = installAssistantLaunch({
      ...launcher.environment,
      whenNavigationReady: (run) => run(),
    });
    expect(isTranscribing).toHaveBeenCalledTimes(1);

    launcher.gesture();
    expect(isTranscribing).toHaveBeenCalledTimes(2);

    dispose();
    expect(launcher.remove).toHaveBeenCalledOnce();
    expect(installAssistantLaunch(null)()).toBeUndefined();
  });
});
