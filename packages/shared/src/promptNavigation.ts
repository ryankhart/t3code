// Custom build: the "Previous prompt" and "Next prompt" buttons that walk a chat one
// prompt per press. Shared by the web timeline and the phone feed; both are LegendLists.
// Above the first loaded prompt, "Previous" goes to the very top instead, where the
// list header offers to load earlier activity.

/** Scroll drift (px) that still counts as "where the last press left the list". */
export const PROMPT_JUMP_STILL_TOLERANCE = 8;

export interface PromptJumpListState<Item> {
  readonly data: ReadonlyArray<Item>;
  /** First row with any part inside the viewport. */
  readonly start: number;
  readonly scroll: number;
  /** At the very top, every prompt above the reader is already on screen. */
  readonly isAtStart?: boolean;
  /** At the very bottom, the list can't bring a later prompt any higher. */
  readonly isAtEnd?: boolean;
  readonly indexByKey: (key: string) => number | undefined;
}

export interface PromptJumpList<Item> {
  getState(): PromptJumpListState<Item>;
  scrollToIndex(params: {
    readonly index: number;
    readonly animated?: boolean;
    readonly viewOffset?: number;
  }): Promise<void>;
  scrollToOffset(params: { readonly offset: number; readonly animated?: boolean }): unknown;
}

export interface PromptJumpScrollOptions {
  readonly animated: boolean;
  readonly viewOffset: number;
}

export type PromptJumpDirection = "back" | "forward";

/** The nearest prompt from `fromIndex` (inclusive) in the given direction. */
function nearestPrompt<Item>(
  data: ReadonlyArray<Item>,
  isPrompt: (item: Item) => boolean,
  fromIndex: number,
  direction: PromptJumpDirection,
): number | null {
  if (direction === "back") {
    for (let index = Math.min(fromIndex, data.length - 1); index >= 0; index -= 1) {
      const item = data[index];
      if (item !== undefined && isPrompt(item)) return index;
    }
    return null;
  }
  for (let index = Math.max(fromIndex, 0); index < data.length; index += 1) {
    const item = data[index];
    if (item !== undefined && isPrompt(item)) return index;
  }
  return null;
}

const step = (direction: PromptJumpDirection) => (direction === "back" ? -1 : 1);

/**
 * The prompt one press should land on. Back: the start of the turn being read (the
 * prompt at or above the first visible row). Forward: the first prompt below the first
 * visible row. When the list still sits where the last press left it, both step from
 * that prompt instead.
 */
export function resolvePromptJumpTarget<Item>(input: {
  readonly state: PromptJumpListState<Item>;
  readonly isPrompt: (item: Item) => boolean;
  readonly direction: PromptJumpDirection;
  readonly lastLanding: { readonly key: string; readonly scroll: number } | null;
}): number | null {
  const { state, isPrompt, direction, lastLanding } = input;
  if (state.data.length === 0) return null;
  if (direction === "back" ? state.isAtStart === true : state.isAtEnd === true) return null;
  if (lastLanding !== null) {
    const landedIndex = state.indexByKey(lastLanding.key);
    if (
      landedIndex !== undefined &&
      Math.abs(state.scroll - lastLanding.scroll) <= PROMPT_JUMP_STILL_TOLERANCE
    ) {
      return nearestPrompt(state.data, isPrompt, landedIndex + step(direction), direction);
    }
  }
  if (!Number.isInteger(state.start) || state.start < 0) return null;
  return nearestPrompt(
    state.data,
    isPrompt,
    direction === "back" ? state.start : state.start + 1,
    direction,
  );
}

/**
 * Remembers where the last press landed so the next press keeps walking from there.
 * A press during a running jump goes one prompt past that jump's target.
 */
export function createPromptNavigator<Item>(options: {
  readonly isPrompt: (item: Item) => boolean;
  readonly keyOf: (item: Item) => string;
}) {
  let lastLanding: { key: string; scroll: number } | null = null;
  let inFlight: { key: string } | "top" | null = null;
  let generation = 0;

  const targetFor = (
    state: PromptJumpListState<Item>,
    direction: PromptJumpDirection,
  ): number | "top" | null => {
    let prompt: number | null;
    if (inFlight === "top") {
      if (direction === "back") return null;
      prompt = nearestPrompt(state.data, options.isPrompt, 0, direction);
    } else {
      const index = inFlight === null ? undefined : state.indexByKey(inFlight.key);
      prompt =
        index !== undefined
          ? nearestPrompt(state.data, options.isPrompt, index + step(direction), direction)
          : resolvePromptJumpTarget({
              state,
              isPrompt: options.isPrompt,
              direction,
              lastLanding,
            });
    }
    // No earlier prompt is loaded, but the list goes higher: head for the top, where
    // earlier activity can be loaded.
    if (prompt === null && direction === "back" && state.isAtStart === false) return "top";
    return prompt;
  };

  const canGo = (
    list: PromptJumpList<Item> | null | undefined,
    direction: PromptJumpDirection,
  ): boolean => {
    if (!list) return false;
    return targetFor(list.getState(), direction) !== null;
  };

  const go = async (
    list: PromptJumpList<Item> | null | undefined,
    direction: PromptJumpDirection,
    scroll: PromptJumpScrollOptions,
  ): Promise<void> => {
    if (!list) return;
    const before = list.getState();
    const target = targetFor(before, direction);
    if (target === null) return;
    const current = ++generation;
    if (target === "top") {
      inFlight = "top";
      try {
        await list.scrollToOffset({ offset: 0, animated: scroll.animated });
      } catch {
        // A failed scroll leaves the reader where they were.
      }
      if (current === generation) {
        inFlight = null;
        lastLanding = null;
      }
      return;
    }
    const item = before.data[target];
    if (item === undefined) return;
    inFlight = { key: options.keyOf(item) };
    try {
      await list.scrollToIndex({ index: target, ...scroll });
    } catch {
      if (current === generation) inFlight = null;
      return;
    }
    if (current !== generation) return;
    const after = list.getState();
    inFlight = null;
    lastLanding = { key: options.keyOf(item), scroll: after.scroll };
    // The prompt already sat where a press puts it (e.g. right after sending it, or the
    // reader scrolled it there), so the press would look dead: keep going one more.
    if (
      Math.abs(after.scroll - before.scroll) <= PROMPT_JUMP_STILL_TOLERANCE &&
      targetFor(after, direction) !== null
    ) {
      await go(list, direction, scroll);
    }
  };

  return {
    canGoBack: (list: PromptJumpList<Item> | null | undefined) => canGo(list, "back"),
    canGoForward: (list: PromptJumpList<Item> | null | undefined) => canGo(list, "forward"),
    goBack: (list: PromptJumpList<Item> | null | undefined, scroll: PromptJumpScrollOptions) =>
      go(list, "back", scroll),
    goForward: (list: PromptJumpList<Item> | null | undefined, scroll: PromptJumpScrollOptions) =>
      go(list, "forward", scroll),
  };
}
