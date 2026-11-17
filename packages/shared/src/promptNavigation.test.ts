import { describe, expect, it } from "vite-plus/test";

import {
  createPromptNavigator,
  type PromptJumpList,
  resolvePromptJumpTarget,
} from "./promptNavigation.ts";

interface Row {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly height: number;
}

const VIEW_OFFSET = 24;
const VIEWPORT = 800;

// A list of rows stacked top to bottom; `scroll` is the viewport's top edge.
function fakeList(rows: ReadonlyArray<Row>, scroll: number) {
  const positions: number[] = [];
  let top = 0;
  for (const row of rows) {
    positions.push(top);
    top += row.height;
  }
  const maxScroll = Math.max(0, top - VIEWPORT);
  const state = { scroll };
  const jumps: Array<number | "top"> = [];
  const list: PromptJumpList<Row> = {
    getState: () => ({
      data: rows,
      scroll: state.scroll,
      isAtStart: state.scroll <= 0,
      isAtEnd: state.scroll >= maxScroll,
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
      state.scroll = Math.min(maxScroll, Math.max(0, (positions[index] ?? 0) - viewOffset));
    },
    scrollToOffset: async ({ offset }) => {
      jumps.push("top");
      state.scroll = Math.min(maxScroll, Math.max(0, offset));
    },
  };
  return { list, jumps, state, positions, maxScroll };
}

// Prompts at 0, 640 and 1280; the list ends at 2220, so it scrolls up to 1420.
const rows: ReadonlyArray<Row> = [
  { id: "u1", role: "user", height: 40 },
  { id: "a1", role: "assistant", height: 600 },
  { id: "u2", role: "user", height: 40 },
  { id: "a2", role: "assistant", height: 600 },
  { id: "u3", role: "user", height: 40 },
  { id: "a3", role: "assistant", height: 900 },
];

const isPrompt = (row: Row) => row.role === "user";
const navigator = () => createPromptNavigator<Row>({ isPrompt, keyOf: (row) => row.id });
const scrollOptions = { animated: false, viewOffset: VIEW_OFFSET };

describe("resolvePromptJumpTarget", () => {
  it("goes back to the prompt of the reply being read", () => {
    const { list } = fakeList(rows, 1420);
    expect(
      resolvePromptJumpTarget({
        state: list.getState(),
        isPrompt,
        direction: "back",
        lastLanding: null,
      }),
    ).toBe(4);
  });

  it("goes forward to the first prompt below the top of the view", () => {
    const { list } = fakeList(rows, 300);
    expect(
      resolvePromptJumpTarget({
        state: list.getState(),
        isPrompt,
        direction: "forward",
        lastLanding: null,
      }),
    ).toBe(2);
  });

  it("steps from the last landing only while the list still sits there", () => {
    const landed = fakeList(rows, 616).list.getState();
    const lastLanding = { key: "u2", scroll: 616 };
    expect(
      resolvePromptJumpTarget({ state: landed, isPrompt, direction: "back", lastLanding }),
    ).toBe(0);
    expect(
      resolvePromptJumpTarget({ state: landed, isPrompt, direction: "forward", lastLanding }),
    ).toBe(4);
    const scrolledAway = fakeList(rows, 1420).list.getState();
    expect(
      resolvePromptJumpTarget({ state: scrolledAway, isPrompt, direction: "back", lastLanding }),
    ).toBe(4);
  });

  it("has nothing to go back to at the very top", () => {
    const { list } = fakeList(rows, 0);
    expect(
      resolvePromptJumpTarget({
        state: list.getState(),
        isPrompt,
        direction: "back",
        lastLanding: null,
      }),
    ).toBeNull();
  });

  it("has nothing to go forward to at the very bottom", () => {
    const { list } = fakeList(rows, 1420);
    expect(
      resolvePromptJumpTarget({
        state: list.getState(),
        isPrompt,
        direction: "forward",
        lastLanding: null,
      }),
    ).toBeNull();
  });

  it("has nothing to go forward to while reading the last reply", () => {
    const { list } = fakeList(rows, 1350);
    expect(
      resolvePromptJumpTarget({
        state: list.getState(),
        isPrompt,
        direction: "forward",
        lastLanding: null,
      }),
    ).toBeNull();
  });

  it("has nothing to go to in an empty list", () => {
    const { list } = fakeList([], 0);
    for (const direction of ["back", "forward"] as const) {
      expect(
        resolvePromptJumpTarget({ state: list.getState(), isPrompt, direction, lastLanding: null }),
      ).toBeNull();
    }
  });
});

describe("createPromptNavigator going back", () => {
  it("walks back one prompt per press, starting with the last prompt", async () => {
    const { list, jumps } = fakeList(rows, 1420);
    const nav = navigator();
    await nav.goBack(list, scrollOptions);
    await nav.goBack(list, scrollOptions);
    await nav.goBack(list, scrollOptions);
    expect(jumps).toEqual([4, 2, 0]);
    expect(nav.canGoBack(list)).toBe(false);
  });

  it("starts over from where the reader scrolled to", async () => {
    const { list, jumps, state } = fakeList(rows, 1420);
    const nav = navigator();
    await nav.goBack(list, scrollOptions);
    state.scroll = 900; // inside the second reply
    await nav.goBack(list, scrollOptions);
    expect(jumps).toEqual([4, 2]);
  });

  it("treats a prompt just under the top edge as already read", async () => {
    const { positions } = fakeList(rows, 0);
    const placed = fakeList(rows, (positions[4] ?? 0) - VIEW_OFFSET + 4);
    await navigator().goBack(placed.list, scrollOptions);
    expect(placed.jumps).toEqual([2]);
  });

  it("keeps going when a press leaves the list where it was", async () => {
    const { list, jumps } = fakeList(rows, 1420);
    const scrollToIndex = list.scrollToIndex;
    let ignored = false;
    const stuck: PromptJumpList<Row> = {
      getState: list.getState,
      scrollToOffset: list.scrollToOffset,
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
    const { list, jumps } = fakeList(rows, 1420);
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

describe("createPromptNavigator going forward", () => {
  it("walks forward one prompt per press from the top", async () => {
    const { list, jumps } = fakeList(rows, 0);
    const nav = navigator();
    await nav.goForward(list, scrollOptions);
    await nav.goForward(list, scrollOptions);
    expect(jumps).toEqual([2, 4]);
    // The last prompt sits as high as the list lets it, so there is nowhere further.
    expect(nav.canGoForward(list)).toBe(false);
  });

  it("retraces the prompts the back button visited", async () => {
    const { list, jumps } = fakeList(rows, 1420);
    const nav = navigator();
    await nav.goBack(list, scrollOptions);
    await nav.goBack(list, scrollOptions);
    await nav.goBack(list, scrollOptions);
    await nav.goForward(list, scrollOptions);
    await nav.goForward(list, scrollOptions);
    expect(jumps).toEqual([4, 2, 0, 2, 4]);
  });

  it("skips a prompt the reader already scrolled to the top", async () => {
    const { positions } = fakeList(rows, 0);
    const placed = fakeList(rows, (positions[2] ?? 0) - VIEW_OFFSET);
    await navigator().goForward(placed.list, scrollOptions);
    expect(placed.jumps).toEqual([2, 4]);
  });

  it("goes one prompt further forward when pressed during a jump", async () => {
    const { list, jumps } = fakeList(rows, 0);
    const nav = navigator();
    const first = nav.goForward(list, scrollOptions);
    const second = nav.goForward(list, scrollOptions);
    await Promise.all([first, second]);
    expect(jumps).toEqual([2, 4]);
  });

  it("can't go forward without a list", () => {
    expect(navigator().canGoForward(null)).toBe(false);
  });
});

describe("createPromptNavigator above the first loaded prompt", () => {
  // The loaded window starts partway through a long agent run: no prompt above the reader.
  const runRows: ReadonlyArray<Row> = [
    { id: "a0", role: "assistant", height: 1200 },
    { id: "u1", role: "user", height: 40 },
    { id: "a1", role: "assistant", height: 900 },
  ];

  it("goes to the very top, where earlier activity can be loaded", async () => {
    const { list, jumps, state } = fakeList(runRows, 500);
    const nav = navigator();
    expect(nav.canGoBack(list)).toBe(true);
    await nav.goBack(list, scrollOptions);
    expect(jumps).toEqual(["top"]);
    expect(state.scroll).toBe(0);
    expect(nav.canGoBack(list)).toBe(false);
  });

  it("goes to the top after the first prompt", async () => {
    const { list, jumps } = fakeList(runRows, 1340);
    const nav = navigator();
    await nav.goBack(list, scrollOptions);
    await nav.goBack(list, scrollOptions);
    expect(jumps).toEqual([1, "top"]);
    expect(nav.canGoBack(list)).toBe(false);
  });

  it("ignores a second press up while heading for the top, but Next still works", async () => {
    const { list, jumps } = fakeList(runRows, 500);
    const nav = navigator();
    const toTop = nav.goBack(list, scrollOptions);
    expect(nav.canGoBack(list)).toBe(false);
    const again = nav.goBack(list, scrollOptions);
    const next = nav.goForward(list, scrollOptions);
    await Promise.all([toTop, again, next]);
    expect(jumps).toEqual(["top", 1]);
  });

  it("offers Next back to the first prompt from the top", async () => {
    const { list, jumps } = fakeList(runRows, 0);
    const nav = navigator();
    await nav.goForward(list, scrollOptions);
    expect(jumps).toEqual([1]);
  });
});
