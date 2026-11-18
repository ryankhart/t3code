import { Atom } from "effect/reactivity";

import * as Dialog from "../../components/ui/Dialog";
import { whenRootNavigationReady } from "../../lib/rootNavigation";
import { appAtomRegistry } from "../../state/atom-registry";
import { createNewTaskDraft, waitForComposerDraftsLoaded } from "../../state/use-composer-drafts";
import {
  scratchDraftEnvironmentIdAtom,
  shellsSettledAtom,
} from "../prompt-links/newTaskPromptLink";
import { startNoProjectThread } from "../threads/startNoProjectThread";
import { talkMode } from "../talk-mode/talkModeRuntime";
import { showThreadActionNotice } from "../threads/thread-action-notice";
import { dictationRouteSettled, isTranscribingDictation } from "../voice-input/VoiceInputProvider";
import type { AssistantLaunchEnvironment } from "./assistantLaunch";
import { assistantModule } from "./assistantModule";

const DICTATION_READY_WAIT_MS = 5_000;

// Null until connections settle: the most recently used environment may still be connecting.
const settledScratchEnvironmentIdAtom = Atom.make((get) =>
  get(shellsSettledAtom) ? get(scratchDraftEnvironmentIdAtom) : null,
).pipe(Atom.withLabel("mobile:assistant:scratch-environment"));

async function draftsLoaded(): Promise<boolean> {
  try {
    await waitForComposerDraftsLoaded();
    return true;
  } catch {
    Dialog.alert("Could not start a thread", "Drafts could not be loaded. Try again.");
    return false;
  }
}

/** The app's wiring for `installAssistantLaunch`; null where there is no assistant slot (iOS). */
export function assistantLaunchEnvironment(
  linkTo: (href: string) => void,
): AssistantLaunchEnvironment | null {
  if (!assistantModule) return null;
  return {
    assistant: assistantModule,
    whenNavigationReady: whenRootNavigationReady,
    linkTo,
    isTranscribing: isTranscribingDictation,
    scratchEnvironmentId: (when) =>
      appAtomRegistry.get(
        when === "settled" ? settledScratchEnvironmentIdAtom : scratchDraftEnvironmentIdAtom,
      ),
    onScratchEnvironmentChange: (listener) =>
      appAtomRegistry.subscribe(settledScratchEnvironmentIdAtom, listener),
    showConnecting: () =>
      showThreadActionNotice({
        phase: "running",
        label: "Connecting to start a thread",
        description: null,
      }),
    startNoProjectThread,
    draftsLoaded,
    dictationReady: () => dictationRouteSettled(DICTATION_READY_WAIT_MS),
    createDraft: (project) =>
      createNewTaskDraft({ environmentId: project.environmentId, projectId: project.id }),
    dictate: (draftKey) => talkMode.start(draftKey),
  };
}
