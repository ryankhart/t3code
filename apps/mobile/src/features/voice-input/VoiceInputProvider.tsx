import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { AudioModule, RecordingPresets, type RecordingStatus } from "expo-audio";
import { File } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { Effect } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { makeMutable } from "react-native-reanimated";

import {
  type MicrophoneEntry,
  microphoneOrder,
  preferredMicrophoneInput,
  rememberMicrophones,
} from "../../lib/microphonePriority";
import { getLocalVoiceTranscriber } from "../../native/voiceTranscription";
import { createVoiceRecorder } from "../../native/voiceRecorder";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { getComposerDraftSnapshot, setComposerDraftText } from "../../state/use-composer-drafts";
import { getNativeShowcaseScene } from "../showcase/nativeShowcaseScene";
import {
  voiceInputBlocksSubmission,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";
import { createLazyVoiceRecorder } from "./lazyVoiceRecorder";
import { VOICE_WAVEFORM_SAMPLE_COUNT } from "./voiceInputMetering";
import { createVoiceInputTarget, VoiceInputSession } from "./voiceInputSession";
import { createVoiceRecordingPermission } from "./voiceRecordingPermission";
import { voiceGrantLoadedAtom, voiceRouteAtom } from "./voiceDestination";
import { makePermissionStatusAtom } from "../../lib/permissionStatusAtom";
import {
  acquireAudioSession,
  activateAudioSession,
  releaseAudioSession,
} from "../../lib/audioSession";

// The native constructor expects platform-flattened options, as built by useAudioRecorder.
const { ios: IOS_RECORDING_OPTIONS, android: ANDROID_RECORDING_OPTIONS } =
  RecordingPresets.HIGH_QUALITY;
const VOICE_RECORDING_OPTIONS = {
  extension: RecordingPresets.HIGH_QUALITY.extension,
  sampleRate: RecordingPresets.HIGH_QUALITY.sampleRate,
  numberOfChannels: RecordingPresets.HIGH_QUALITY.numberOfChannels,
  bitRate: RecordingPresets.HIGH_QUALITY.bitRate,
  isMeteringEnabled: true,
  ...(Platform.OS === "ios" ? IOS_RECORDING_OPTIONS : ANDROID_RECORDING_OPTIONS),
};

function keepScreenAwake(tag: string): () => void {
  const activation = activateKeepAwakeAsync(tag);
  void activation.catch(() => {});
  // Release after activation settles, even if the recording ends immediately.
  return () => void activation.then(() => deactivateKeepAwake(tag)).catch(() => {});
}

export const deviceMicrophoneOrder = (saved?: ReadonlyArray<MicrophoneEntry>) =>
  microphoneOrder(saved, Platform.OS === "android" ? "android" : "ios");

/** "checking" until the first availability probe settles; re-probed on foreground. */
export const localVoiceTranscriberAtom = makePermissionStatusAtom<
  VoiceTranscriber | null | "checking"
>({
  label: "mobile:voice-input:transcriber",
  initial: "checking",
  read: () => getLocalVoiceTranscriber().catch(() => null),
}).pipe(Atom.keepAlive);

const voiceInputAvailableAtom = Atom.make((get) => {
  const route = get(voiceRouteAtom);
  if (route) return route.transcriber !== null;
  const transcriber = get(localVoiceTranscriberAtom);
  return transcriber !== null && transcriber !== "checking";
});

/**
 * The app has one microphone and one dictation at a time, so the session
 * lives for the registry's lifetime rather than any screen's.
 */
export const voiceInputAtom = Atom.make((get) => {
  const registry = get.registry;
  // Mounted so the recorder can read known microphones synchronously.
  get.mount(mobilePreferencesAtom);
  const audioLevels = makeMutable<ReadonlyArray<number>>(
    Array<number>(VOICE_WAVEFORM_SAMPLE_COUNT).fill(0),
  );
  let keepAwakeSequence = 0;
  let audioToken: ReturnType<typeof acquireAudioSession> | null = null;
  let recordingMicrophoneOrder: ReadonlyArray<MicrophoneEntry> | null = null;
  const permission = createVoiceRecordingPermission(() => {
    void session.controller.appMovedToBackground();
  });
  const recorder = createLazyVoiceRecorder({
    getDestination: () => (registry.get(voiceRouteAtom) === null ? "local" : "environment"),
    create: (destination) =>
      destination === "local"
        ? createVoiceRecorder(VOICE_RECORDING_OPTIONS)
        : new AudioModule.AudioRecorder(VOICE_RECORDING_OPTIONS),
    onStatus: (status: RecordingStatus) => {
      session.controller.handleRecorderStatus({
        isFinished: status.isFinished,
        hasError: status.hasError || status.mediaServicesDidReset === true,
        error: status.error,
        url: status.url,
      });
    },
    selectInput: (inputs) => {
      const known = recordingMicrophoneOrder;
      if (!known) return null;
      const order = rememberMicrophones(known, inputs);
      if (order !== known) {
        void runAtomCommand(registry, saveMobilePreferences, {
          transform: (current) => ({
            microphones: rememberMicrophones(deviceMicrophoneOrder(current.microphones), inputs),
          }),
        });
      }
      return preferredMicrophoneInput(inputs, order);
    },
  });
  const session: VoiceInputSession = new VoiceInputSession({
    recorder,
    getTranscriber: () => {
      const route = registry.get(voiceRouteAtom);
      if (route) return route.transcriber;
      const transcriber = registry.get(localVoiceTranscriberAtom);
      return transcriber === "checking" ? null : transcriber;
    },
    requestPermission: permission.requestPermission,
    configureRecording: async () => {
      const token = acquireAudioSession("recording");
      audioToken = token;
      try {
        const current = registry.get(mobilePreferencesAtom);
        const preferences = AsyncResult.isSuccess(current)
          ? current.value
          : await Effect.runPromise(
              AtomRegistry.getResult(registry, mobilePreferencesAtom).pipe(
                Effect.orElseSucceed(() => null),
              ),
            );
        recordingMicrophoneOrder = preferences
          ? deviceMicrophoneOrder(preferences.microphones)
          : null;
        const builtInMicFirst =
          Platform.OS === "ios" && recordingMicrophoneOrder?.[0]?.kind === "builtIn";
        await activateAudioSession(token, { allowBluetoothRecording: !builtInMicFirst });
      } catch (error) {
        await releaseAudioSession(token).catch(() => {});
        throw error;
      }
    },
    releaseRecording: async () => {
      if (audioToken) await releaseAudioSession(audioToken);
      audioToken = null;
    },
    deleteRecording: (uri) => new File(uri).delete(),
    sampleRecording: () => {
      const status = recorder.getStatus();
      return status?.isRecording
        ? { durationMillis: status.durationMillis, metering: status.metering }
        : null;
    },
    publishAudioLevels: (levels) => audioLevels.set(levels),
    keepAwake: () => keepScreenAwake(`voice-input:${++keepAwakeSequence}`),
  });
  get.subscribe(voiceRouteAtom, () => session.controller.cancel());
  get.addFinalizer(() => {
    permission.dispose();
    session.dispose();
    recorder.release();
  });
  return { session, audioLevels };
}).pipe(Atom.keepAlive, Atom.withLabel("mobile:voice-input"));

/** Whether a finished recording is still being turned into text, for callers outside React. */
export function isTranscribingDictation(): boolean {
  const { phase } = appAtomRegistry.get(voiceInputAtom).session.getSnapshot().state;
  return phase === "transcribing" || phase === "post-processing";
}

export function useTranscribingDictation(): boolean {
  const { session } = useAtomValue(voiceInputAtom);
  return useSyncExternalStore(session.subscribe, isTranscribingDictation);
}

// A dictation is cancelled when its transcription route changes, and right after a launch the
// route still changes: the saved choice loads, then its environment connects.
const voiceRouteSettledAtom = Atom.make((get) => {
  if (!get(voiceGrantLoadedAtom)) return false;
  const route = get(voiceRouteAtom);
  return route ? route.transcriber !== null : get(localVoiceTranscriberAtom) !== "checking";
});

/**
 * Resolves once a dictation can start and stay started, or after `timeoutMs`, so a route that
 * never settles (its environment is offline) cannot hold a start forever.
 */
export function dictationRouteSettled(timeoutMs: number): Promise<void> {
  if (appAtomRegistry.get(voiceRouteSettledAtom)) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      stop();
      resolve();
    };
    const stop = appAtomRegistry.subscribe(voiceRouteSettledAtom, (settled) => {
      if (settled) finish();
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * Hands-free dictation into a draft: it ends itself after a pause in speech. Reports whether the
 * words reached the draft, or the dictation ended any other way (nothing said, cancelled,
 * interrupted, refused).
 */
export function dictateHandsFree(
  draftKey: string,
  label: string,
  events: { readonly onCommitted: () => void; readonly onEnded: () => void },
): void {
  const { session } = appAtomRegistry.get(voiceInputAtom);
  const end = getComposerDraftSnapshot(draftKey).text.length;
  let started = false;
  let committed = false;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    unsubscribe();
    if (committed) events.onCommitted();
    else events.onEnded();
  };
  const unsubscribe = session.subscribe(() => {
    const { ownerKey, state } = session.getSnapshot();
    if (ownerKey !== draftKey || state.phase === "idle" || state.phase === "error") {
      if (started) finish();
      return;
    }
    started = true;
  });
  session
    .start({
      ...createVoiceInputTarget(
        draftKey,
        () => getComposerDraftSnapshot(draftKey).text,
        (text) => {
          setComposerDraftText(draftKey, text);
          committed = true;
        },
        { start: end, end },
      ),
      label,
      onNoSpeech: () => {},
    })
    .then(() => {
      if (!started) finish();
    }, finish);
}

/** Ends a hands-free dictation into `draftKey`, if it is still running. */
export function cancelDictation(draftKey: string): void {
  appAtomRegistry.get(voiceInputAtom).session.cancel(draftKey);
}

export function useGlobalVoiceInput() {
  const { session, audioLevels } = useAtomValue(voiceInputAtom);
  const isTranscriberAvailable = useAtomValue(voiceInputAvailableAtom);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return {
    ...snapshot,
    isAvailable: isTranscriberAvailable || getNativeShowcaseScene() !== null,
    audioLevels,
    isBusy: voiceInputBlocksSubmission(snapshot.state),
    session,
    stop: () => session.controller.stop(),
    cancel: () => session.controller.cancel(),
  };
}
