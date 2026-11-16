import type { ScopedThreadRef } from "@t3tools/contracts";

type SettleAndAdvance = (threadRef: ScopedThreadRef) => Promise<void>;

let registeredSettleAndAdvance: SettleAndAdvance | null = null;

export function registerSettleAndAdvance(handler: SettleAndAdvance): () => void {
  registeredSettleAndAdvance = handler;
  return () => {
    if (registeredSettleAndAdvance === handler) registeredSettleAndAdvance = null;
  };
}

/** Settles through the sidebar, finishing once it has moved on; null means no sidebar is mounted, so settle in place. */
export function settleAndAdvance(threadRef: ScopedThreadRef): Promise<void> | null {
  return registeredSettleAndAdvance?.(threadRef) ?? null;
}
