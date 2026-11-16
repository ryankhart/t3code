import type { MenuAction } from "@react-native-menu/menu";
import { buildThreadActionMenuItems } from "@t3tools/client-runtime/thread-action-menu";
import { describe, expect, it } from "vite-plus/test";

import { menuActionsFromThreadMenu } from "./thread-action-menu";

const items = buildThreadActionMenuItems({
  canOperate: true,
  branch: "main",
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: false,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: true,
  hasCompletedRun: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
  arrange: { canMoveUp: false, canMoveDown: true },
  canOpenProjectSettings: false,
});

const leafIds = (actions: readonly MenuAction[]): string[] =>
  actions.flatMap((action) => (action.subactions ? leafIds(action.subactions) : [action.id!]));

describe("menuActionsFromThreadMenu", () => {
  it("keeps the shared order and states on Android", () => {
    const actions = menuActionsFromThreadMenu(items, { nestAfterFirstGroup: false });
    expect(actions.map((action) => action.id)).toEqual([
      "new-thread-on-branch",
      "pin",
      "settle",
      "snooze",
      "arrange",
      "move-up",
      "move-down",
      "rename",
      "regenerate-title",
      "auto-settle",
      "copy",
      "archive",
      "delete",
    ]);
    const byId = new Map(actions.map((action) => [action.id, action]));
    expect(byId.get("move-up")?.attributes).toEqual({ disabled: true });
    expect(byId.get("archive")?.attributes).toEqual({ disabled: true });
    expect(byId.get("delete")?.attributes).toEqual({ destructive: true });
    expect(byId.get("snooze")?.subactions?.[0]).toMatchObject({
      id: "snooze:hour",
      title: "In 1 hour",
      subtitle: "3:00 PM",
    });
    expect(byId.get("auto-settle")?.subactions?.map((action) => action.state)).toEqual([
      "off",
      "on",
    ]);
    expect(byId.get("copy")?.subactions?.map((action) => action.id)).toEqual([
      "copy-path",
      "copy-branch",
      "copy-thread",
      "copy-thread-id",
    ]);
  });

  it("puts everything after the first group under More on iOS, keeping each action once", () => {
    const flat = menuActionsFromThreadMenu(items, { nestAfterFirstGroup: false });
    const nested = menuActionsFromThreadMenu(items, { nestAfterFirstGroup: true });
    expect(nested.map((action) => action.id)).toEqual([
      "new-thread-on-branch",
      "pin",
      "settle",
      "snooze",
      "arrange",
      "move-up",
      "move-down",
      "more",
    ]);
    expect(nested.at(-1)?.subactions?.[0]?.id).toBe("rename");
    expect(leafIds(nested)).toEqual(leafIds(flat));
  });
});
