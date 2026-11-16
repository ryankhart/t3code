import { describe, expect, it } from "vite-plus/test";

import {
  createPreviousPromptNavigator,
  type PreviousPromptList,
  resolvePreviousPromptTarget,
} from "./previousPrompt.ts";

interface Row {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly height: number;
}

const VIEW_OFFSET = 24;

// A list of rows stacked top to bottom; `scroll` is the viewport's top edge.
function fakeList(rows: ReadonlyArray<Row>, scroll: number) {
  const positions: number[] = [];
  let top = 0;
  for (const row of rows) {
    positions.push(top);
    top += row.height;
  }
  const state = { scroll };
  const jumps: number[] = [];
  const list: PreviousPromptList<Row> = {
    getState: () => ({
      data: rows,
      scroll: state.scroll,
      isAtStart: state.scroll <= 0,
      start: positions.findIndex(
        (position, index) => position + (rows[index]?.height ?? 0) > state.scroll,
      ),
      indexByKey: (key) => {
        const index = rows.findIndex((row) => row.id === key);
        return index === -1 ? undefined : index;
      },
    }),
    scrollToIndex: async ({ index, viewOffset = 0 }) => {
      jumps.push(index);
      state.scroll = Math.max(0, (positions[index] ?? 0) - viewOffset);
    },
  };
  return { list, jumps, state, positions };
}

const rows: ReadonlyArray<Row> = [
  { id: "u1", role: "user", height: 40 },
  { id: "a1", role: "assistant", height: 600 },
  { id: "u2", role: "user", height: 40 },
  { id: "a2", role: "assistant", height: 600 },
  { id: "u3", role: "user", height: 40 },
  { id: "a3", role: "assistant", height: 900 },
];

const isPrompt = (row: Row) => row.role === "user";
const navigator = () => createPreviousPromptNavigator<Row>({ isPrompt, keyOf: (row) => row.id });
const scrollOptions = { animated: false, viewOffset: VIEW_OFFSET };

describe("resolvePreviousPromptTarget", () => {
  it("targets the prompt of the reply being read", () => {
    const { list } = fakeList(rows, 2000);
    expect(
      resolvePreviousPromptTarget({ state: list.getState(), isPrompt, lastLanding: null }),
    ).toBe(4);
  });

  it("goes before the last landing only while the list still sits there", () => {
    const landed = fakeList(rows, 1256).list.getState();
    expect(
      resolvePreviousPromptTarget({
        state: landed,
        isPrompt,
        lastLanding: { key: "u2", scroll: 1260 },
      }),
    ).toBe(0);
    const scrolledAway = fakeList(rows, 2000).list.getState();
    expect(
      resolvePreviousPromptTarget({
        state: scrolledAway,
        isPrompt,
        lastLanding: { key: "u2", scroll: 1260 },
      }),
    ).toBe(4);
  });

  it("has nothing to go to at the very top", () => {
    const { list } = fakeList(rows, 0);
    expect(
      resolvePreviousPromptTarget({ state: list.getState(), isPrompt, lastLanding: null }),
    ).toBeNull();
  });

  it("has nothing to go to in an empty list", () => {
    const { list } = fakeList([], 0);
    expect(
      resolvePreviousPromptTarget({ state: list.getState(), isPrompt, lastLanding: null }),
    ).toBeNull();
  });
});

describe("createPreviousPromptNavigator", () => {
  it("walks back one prompt per press, starting with the last prompt", async () => {
    const { list, jumps } = fakeList(rows, 2000);
    const nav = navigator();
    await nav.goBack(list, scrollOptions);
    await nav.goBack(list, scrollOptions);
    await nav.goBack(list, scrollOptions);
    expect(jumps).toEqual([4, 2, 0]);
    expect(nav.canGoBack(list)).toBe(false);
  });

  it("starts over from where the reader scrolled to", async () => {
    const { list, jumps, state } = fakeList(rows, 2000);
    const nav = navigator();
    await nav.goBack(list, scrollOptions);
    state.scroll = 900; // inside the second reply
    await nav.goBack(list, scrollOptions);
    expect(jumps).toEqual([4, 2]);
  });

  it("treats a prompt just under the top edge as already read", async () => {
    const { list, jumps, positions } = fakeList(rows, 0);
    list.getState(); // positions are filled in
    const placed = fakeList(rows, (positions[4] ?? 0) - VIEW_OFFSET + 4);
    await navigator().goBack(placed.list, scrollOptions);
    expect(placed.jumps).toEqual([2]);
    expect(jumps).toEqual([]);
  });

  it("keeps going when a press leaves the list where it was", async () => {
    const { list, jumps } = fakeList(rows, 2000);
    const scrollToIndex = list.scrollToIndex;
    let ignored = false;
    const stuck: PreviousPromptList<Row> = {
      getState: list.getState,
      scrollToIndex: async (params) => {
        if (!ignored) {
          ignored = true;
          jumps.push(params.index);
          return;
        }
        await scrollToIndex(params);
      },
    };
    await navigator().goBack(stuck, scrollOptions);
    expect(jumps).toEqual([4, 2]);
  });

  it("stops at the first prompt", async () => {
    const { list, jumps } = fakeList(rows, 10);
    const nav = navigator();
    await nav.goBack(list, scrollOptions);
    expect(jumps).toEqual([0]);
    expect(nav.canGoBack(list)).toBe(false);
  });

  it("goes one prompt further back when pressed during a jump", async () => {
    const { list, jumps } = fakeList(rows, 2000);
    const nav = navigator();
    const first = nav.goBack(list, scrollOptions);
    const second = nav.goBack(list, scrollOptions);
    await Promise.all([first, second]);
    expect(jumps).toEqual([4, 2]);
  });

  it("can't go back without a list", () => {
    expect(navigator().canGoBack(null)).toBe(false);
  });
});
