import { assert, describe, it } from "@effect/vitest";
import type { WebContents } from "electron";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({ app: {}, BrowserWindow: {}, nativeImage: {} }));

import { anchorInWindowPoints } from "./Extensions.ts";

const anchor = { x: 1000, y: 40, width: 24, height: 24 };
const contentsZoomedTo = (zoom: number) =>
  ({ getZoomFactor: () => zoom }) as unknown as WebContents;

describe("anchorInWindowPoints", () => {
  it("scales by the window hosting the toolbar, not the zoomed page", () => {
    const guest = { ...contentsZoomedTo(2), hostWebContents: contentsZoomedTo(1.25) };
    assert.deepStrictEqual(anchorInWindowPoints(guest, anchor), {
      x: 1250,
      y: 50,
      width: 30,
      height: 30,
    });
  });
});
