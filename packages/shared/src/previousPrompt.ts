// Custom build: the "Previous prompt" button that walks a chat back one prompt per press.
// Shared by the web timeline and the phone feed; both are LegendLists.

/** Scroll drift (px) that still counts as "where the last press left the list". */
export const PREVIOUS_PROMPT_STILL_TOLERANCE = 8;

export interface PreviousPromptListState<Item> {
  readonly data: ReadonlyArray<Item>;
  /** First row with any part inside the viewport. */
  readonly start: number;
  readonly scroll: number;
  /** At the very top, every prompt above the reader is already on screen. */
  readonly isAtStart?: boolean;
  readonly indexByKey: (key: string) => number | undefined;
}

export interface PreviousPromptList<Item> {
  getState(): PreviousPromptListState<Item>;
  scrollToIndex(params: {
    readonly index: number;
    readonly animated?: boolean;
    readonly viewOffset?: number;
  }): Promise<void>;
}

export interface PreviousPromptScrollOptions {
  readonly animated: boolean;
  readonly viewOffset: number;
}

function lastPromptAtOrBefore<Item>(
  data: ReadonlyArray<Item>,
  isPrompt: (item: Item) => boolean,
  fromIndex: number,
): number | null {
  for (let index = Math.min(fromIndex, data.length - 1); index >= 0; index -= 1) {
    const item = data[index];
    if (item !== undefined && isPrompt(item)) return index;
  }
  return null;
}

/**
 * The prompt one press should land on: the start of the turn being read (the prompt
 * at or above the first visible row), or, when the list still sits where the last
 * press left it, the prompt before that one.
 */
export function resolvePreviousPromptTarget<Item>(input: {
  readonly state: PreviousPromptListState<Item>;
  readonly isPrompt: (item: Item) => boolean;
  readonly lastLanding: { readonly key: string; readonly scroll: number } | null;
}): number | null {
  const { state, isPrompt, lastLanding } = input;
  if (state.data.length === 0 || state.isAtStart === true) return null;
  if (lastLanding !== null) {
    const landedIndex = state.indexByKey(lastLanding.key);
    if (
      landedIndex !== undefined &&
      Math.abs(state.scroll - lastLanding.scroll) <= PREVIOUS_PROMPT_STILL_TOLERANCE
    ) {
      return lastPromptAtOrBefore(state.data, isPrompt, landedIndex - 1);
    }
  }
  if (!Number.isInteger(state.start) || state.start < 0) return null;
  return lastPromptAtOrBefore(state.data, isPrompt, state.start);
}

/**
 * Remembers where the last press landed so the next press keeps going back.
 * A press during a running jump goes one prompt further back than that jump.
 */
export function createPreviousPromptNavigator<Item>(options: {
  readonly isPrompt: (item: Item) => boolean;
  readonly keyOf: (item: Item) => string;
}) {
  let lastLanding: { key: string; scroll: number } | null = null;
  let inFlight: { key: string; generation: number } | null = null;
  let generation = 0;

  const targetFor = (state: PreviousPromptListState<Item>): number | null => {
    if (inFlight !== null) {
      const index = state.indexByKey(inFlight.key);
      if (index !== undefined) return lastPromptAtOrBefore(state.data, options.isPrompt, index - 1);
    }
    return resolvePreviousPromptTarget({ state, isPrompt: options.isPrompt, lastLanding });
  };

  const canGoBack = (list: PreviousPromptList<Item> | null | undefined): boolean => {
    if (!list) return false;
    return targetFor(list.getState()) !== null;
  };

  const goBack = async (
    list: PreviousPromptList<Item> | null | undefined,
    scroll: PreviousPromptScrollOptions,
  ): Promise<void> => {
    if (!list) return;
    const before = list.getState();
    const target = targetFor(before);
    if (target === null) return;
    const item = before.data[target];
    if (item === undefined) return;
    const current = ++generation;
    inFlight = { key: options.keyOf(item), generation: current };
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
    // The prompt already sat where a press puts it (e.g. right after sending it), so
    // the press would look dead: keep going to the prompt before it.
    if (Math.abs(after.scroll - before.scroll) <= PREVIOUS_PROMPT_STILL_TOLERANCE) {
      const earlier = lastPromptAtOrBefore(after.data, options.isPrompt, target - 1);
      if (earlier !== null) await goBack(list, scroll);
    }
  };

  return { canGoBack, goBack };
}
