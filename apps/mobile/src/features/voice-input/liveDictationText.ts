import { useSyncExternalStore } from "react";

let text = "";
const listeners = new Set<() => void>();

/** The words heard so far in the current dictation, for "As I speak" (on-device only). */
export function setLiveDictationText(next: string): void {
  if (next === text) return;
  text = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const read = () => text;

export function useLiveDictationText(): string {
  return useSyncExternalStore(subscribe, read);
}
