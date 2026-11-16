import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";

import type { AssistantModule } from "./assistantModule";

const NEW_THREAD_HREF = "/new";
/** How long a gesture waits for an environment to connect before it opens the new-thread screen. */
export const SCRATCH_ENVIRONMENT_WAIT_MS = 8_000;

export interface AssistantLaunchEnvironment {
  readonly assistant: Pick<AssistantModule, "takeLaunch" | "isLaunchCurrent" | "addListener">;
  readonly whenNavigationReady: (run: () => void) => void;
  readonly linkTo: (href: string) => void;
  /**
   * A finished recording is still becoming text. A recording itself never blocks a gesture:
   * Android pauses the app to deliver one, and the voice session ends a recording on pause.
   */
  readonly isTranscribing: () => boolean;
  /**
   * The connected environment a thread without a project starts on. With `settled`, null until
   * every connection has settled, because the most recently used one may still be connecting.
   */
  readonly scratchEnvironmentId: (when: "settled" | "now") => EnvironmentId | null;
  readonly onScratchEnvironmentChange: (listener: () => void) => () => void;
  /** Tells the user the gesture is waiting for a connection; returns the dismiss. */
  readonly showConnecting: () => () => void;
  /** Calls `open` with the No project folder's project, or reports the failure itself. */
  readonly startNoProjectThread: (
    environmentId: EnvironmentId,
    open: (project: EnvironmentProject) => void,
  ) => Promise<void>;
  /** False after reporting that saved drafts could not be read. */
  readonly draftsLoaded: () => Promise<boolean>;
  /** Resolves once a dictation can start and stay started, which a cold launch can beat. */
  readonly dictationReady: () => Promise<void>;
  readonly createDraft: (project: EnvironmentProject) => string;
  readonly dictate: (draftKey: string) => void;
}

function draftHref(draftKey: string, title: string): string {
  return `/new/draft?draftId=${encodeURIComponent(draftKey)}&title=${encodeURIComponent(title)}`;
}

/**
 * The assistant gesture (this app chosen as the digital assistant app) opens a new thread without
 * a project and dictates into it, or opens the new-thread screen when no environment offers one.
 * One launch runs at a time. After each wait it stops if the user left the app, so a gesture can
 * never turn the microphone on later, when the user comes back; or if a transcript is on its way.
 */
export function createAssistantLauncher(
  environment: Omit<AssistantLaunchEnvironment, "whenNavigationReady">,
): () => Promise<void> {
  let launching = false;
  const wanted = () => environment.assistant.isLaunchCurrent() && !environment.isTranscribing();

  // A gesture that starts the app arrives before its environments have connected.
  const scratchEnvironment = () =>
    new Promise<EnvironmentId | null>((resolve) => {
      const ready = environment.scratchEnvironmentId("settled");
      if (ready !== null) {
        resolve(ready);
        return;
      }
      const dismiss = environment.showConnecting();
      const finish = () => {
        clearTimeout(timer);
        unsubscribe();
        dismiss();
        // After the wait, one that is connected beats waiting on another that is still trying.
        resolve(environment.scratchEnvironmentId("now"));
      };
      const unsubscribe = environment.onScratchEnvironmentChange(() => {
        if (environment.scratchEnvironmentId("settled") !== null) finish();
      });
      const timer = setTimeout(finish, SCRATCH_ENVIRONMENT_WAIT_MS);
    });

  const openDictatedDraft = async (project: EnvironmentProject) => {
    const loaded = await environment.draftsLoaded();
    await environment.dictationReady();
    if (!loaded || !wanted()) return;
    const draftKey = environment.createDraft(project);
    environment.linkTo(draftHref(draftKey, project.title));
    environment.dictate(draftKey);
  };

  const launch = async () => {
    const environmentId = await scratchEnvironment();
    if (!wanted()) return;
    if (environmentId === null) {
      environment.linkTo(NEW_THREAD_HREF);
      return;
    }
    let opened: Promise<void> | undefined;
    await environment.startNoProjectThread(environmentId, (project) => {
      opened = openDictatedDraft(project);
    });
    await opened;
  };

  return async () => {
    if (launching || !wanted()) return;
    launching = true;
    try {
      await launch();
    } finally {
      launching = false;
    }
  };
}

/** Runs the launcher for each assistant gesture, including the one that started the app. */
export function installAssistantLaunch(environment: AssistantLaunchEnvironment | null): () => void {
  if (!environment) return () => undefined;
  const launch = createAssistantLauncher(environment);
  const takeLaunch = () => {
    if (environment.assistant.takeLaunch()) void launch();
  };
  const subscription = environment.assistant.addListener("onAssist", takeLaunch);
  // The gesture that started the app arrives before this listener; the native side holds it.
  environment.whenNavigationReady(takeLaunch);
  return () => subscription.remove();
}
