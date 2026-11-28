import { createContext, use, type ReactNode } from "react";

// Only Android's phone layout moves pinned threads into a drawer; elsewhere they stay on top.

export function PinnedThreadsDrawerScope(props: {
  readonly enabled: boolean;
  readonly children: ReactNode;
}) {
  return props.children;
}

const PinnedThreadsDrawerContext = createContext<{
  readonly open: () => void;
  readonly close: () => void;
  readonly shown: boolean;
} | null>(null);

export function usePinnedThreadsDrawer() {
  return use(PinnedThreadsDrawerContext);
}

export function PinnedThreadsDrawerContent(_props: { readonly children: ReactNode }) {
  return null;
}

export function PinnedThreadsSwipeArea(props: { readonly children: ReactNode }) {
  return props.children;
}
