import type { VoiceTranscriber } from "@t3tools/client-runtime/voice-input";

export function subscribeLiveTranscript(_listener: (text: string) => void): () => void {
  return () => {};
}

export async function getLocalVoiceTranscriber(): Promise<VoiceTranscriber | null> {
  return null;
}
