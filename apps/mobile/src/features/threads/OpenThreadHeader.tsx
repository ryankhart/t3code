import { useAtomValue } from "@effect/atom-react";
import { buildThreadActionMenuItems } from "@t3tools/client-runtime/thread-action-menu";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  canSnooze,
  effectiveSnoozed,
  QUEUED_TURN_START_GRACE_MS,
  resolveSnoozePresets,
} from "@t3tools/client-runtime/state/thread-settled";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useMessages } from "gt-react-native";
import { useState, type ComponentProps } from "react";
import { Platform } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import { appBarMenuItemsFromActions } from "../../components/ui/menuActionItems";
import { useNowAfter, useNowMinuteMs } from "../../lib/clock";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import { useEnvironmentScope } from "../../state/session";
import { threadArrangementOpenAtom } from "../../state/thread-order";
import type { useThreadListActions } from "../home/useThreadListActions";
import { threadCanArchive } from "../home/threadArchive";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { CustomSnoozeSheet } from "./CustomSnoozeSheet";
import { menuActionsFromThreadMenu } from "./thread-action-menu";
import { parseMoveToProjectMenuEvent } from "./thread-move-targets";
import { resolveThreadListV2SnoozeMenuSelection } from "./threadListV2";
import { ThreadHeader } from "./ThreadHeader";
import {
  moveThreadToProject,
  turnThreadIntoProject,
  useThreadProjectActions,
} from "./turnThreadIntoProject";
import { useThreadListV2ShelfPreferences } from "./use-thread-list-v2-shelf-preferences";
import { useThreadMenuUtilities } from "./use-thread-menu-utilities";

// Read when a menu item is picked; the menu items themselves are built during render.
const readClock = () => new Date();

/**
 * The open thread's header with every action its thread-list row offers, in the same order, so
 * nothing needs a trip back to the list. Phones show them in the ⋮ menu.
 */
export function OpenThreadHeader(
  props: Omit<ComponentProps<typeof ThreadHeader>, "threadMenuItems"> & {
    readonly thread: EnvironmentThreadShell;
    readonly projectCwd: string | null;
    readonly actions: ReturnType<typeof useThreadListActions>;
    /** Leaves the thread after it was archived or deleted. */
    readonly onLeaveThread: () => void;
  },
) {
  const { thread, projectCwd, actions, onLeaveThread, ...headerProps } = props;
  const m = useMessages();
  const listEnvironments = useAtomValue(threadListEnvironmentsAtom);
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const { canTurnIntoProject, moveTargets } = useThreadProjectActions(thread);
  const runMenuUtility = useThreadMenuUtilities();
  const selectDetail = useSelectWorkspaceDetail();
  const { workingShelfEnabled } = useThreadListV2ShelfPreferences();
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false);

  // Snooze state, its gate and the preset times all move with the clock.
  const snoozeEndsAt = Date.parse(thread.snoozedUntil ?? "");
  const queuedTurnGateEndsAt = Date.parse(thread.latestUserMessageAt ?? "");
  const nowMs = Math.max(
    useNowMinuteMs(),
    useNowAfter(Number.isFinite(snoozeEndsAt) ? snoozeEndsAt + 1 : null),
    useNowAfter(
      Number.isFinite(queuedTurnGateEndsAt)
        ? queuedTurnGateEndsAt + QUEUED_TURN_START_GRACE_MS + 1
        : null,
    ),
  );
  const now = new Date(nowMs);
  const configLoaded = listEnvironments.settlementEnvironmentIds.has(thread.environmentId);
  const presetSettings = listEnvironments.snoozePresetsByEnvironmentId.get(thread.environmentId);
  // Same gate as the thread's list row.
  const canArrange =
    thread.pinnedAt != null
      ? listEnvironments.pinReorderEnvironmentIds.has(thread.environmentId)
      : !workingShelfEnabled &&
        listEnvironments.activeReorderEnvironmentIds.has(thread.environmentId);
  const snoozable = canSnooze(thread, { now: now.toISOString() });
  const snoozePresets = snoozable
    ? resolveSnoozePresets(now, presetSettings ? { presets: presetSettings } : {})
    : [];
  const items = buildThreadActionMenuItems(
    {
    canOperate,
    branch: thread.branch ?? null,
    projectFilter: null,
    isPinned: thread.pinnedAt != null,
    isSettled: thread.settledOverride === "settled",
    autoSettleEnabled: thread.autoSettleDisabledAt == null,
    isSnoozed: configLoaded && effectiveSnoozed(thread, { now: now.toISOString() }),
    canSnoozeNow: snoozable,
    isRegeneratingTitle: thread.titleRegeneration != null,
    isRunning: !threadCanArchive(thread.runtime),
    hasCompletedRun: thread.latestRun?.completedAt != null,
    supports: {
      settlement: configLoaded,
      autoSettleOptOut: listEnvironments.autoSettleOptOutEnvironmentIds.has(thread.environmentId),
      snooze: configLoaded,
      pinning: configLoaded,
      titleRegeneration: configLoaded,
    },
    snoozePresets,
    canTurnIntoProject,
    moveTargets,
    ...(canArrange ? { arrange: { canMoveUp: false, canMoveDown: false } } : {}),
    canOpenProjectSettings: false,
    },
    m,
  );
  // Moving one step only makes sense beside its neighbours in the list; the sheet works anywhere.
  const shownItems = items.filter((item) => item.id !== "move-up" && item.id !== "move-down");

  const handleSelect = (event: string) => {
    if (runMenuUtility(event, thread, projectCwd)) return;
    const moveToProjectId = parseMoveToProjectMenuEvent(event);
    if (moveToProjectId !== null) {
      void moveThreadToProject(thread, moveToProjectId);
      return;
    }
    if (event === "snooze:custom") {
      setCustomSnoozeOpen(true);
      return;
    }
    const snoozeSelection = resolveThreadListV2SnoozeMenuSelection({
      event,
      displayedPresets: snoozePresets,
      now: readClock(),
      presets: presetSettings,
    });
    if (snoozeSelection._tag === "selected") {
      void actions.snoozeThread(thread, snoozeSelection.preset.snoozedUntil);
      return;
    }
    if (snoozeSelection._tag === "expired") {
      Dialog.alert("Could not snooze thread", "That snooze time has passed. Choose another time.");
      return;
    }
    switch (event) {
      case "new-thread-on-branch":
        selectDetail({
          name: "Thread",
          params: {
            draft: {
              requestId: uuidv4(),
              environmentId: String(thread.environmentId),
              projectId: String(thread.projectId),
              branch: thread.branch,
              worktreePath: thread.worktreePath,
            },
          },
        });
        return;
      case "pin":
        void actions.pinThread(thread);
        return;
      case "unpin":
        void actions.unpinThread(thread);
        return;
      case "settle":
      case "unsettle":
        // The header checkmark's path also offers Undo and returns to the list once settled.
        if (props.settle) props.settle.onPress();
        else if (event === "settle") void actions.settleThread(thread);
        else void actions.unsettleThread(thread);
        return;
      case "arrange":
        appAtomRegistry.set(threadArrangementOpenAtom, true);
        return;
      case "unsnooze":
        void actions.unsnoozeThread(thread);
        return;
      case "rename":
        actions.renameThread(thread);
        return;
      case "regenerate-title":
        void actions.regenerateThreadTitle(thread);
        return;
      case "turn-into-project":
        void turnThreadIntoProject(thread);
        return;
      case "auto-settle:enabled":
      case "auto-settle:disabled":
        void actions.setThreadAutoSettle(thread, event === "auto-settle:enabled");
        return;
      case "archive":
        void actions.archiveThread(thread).then((archived) => {
          if (archived) onLeaveThread();
        });
        return;
      case "delete":
        actions.confirmDeleteThread(thread, onLeaveThread);
        return;
    }
  };

  const threadMenuItems = appBarMenuItemsFromActions(
    menuActionsFromThreadMenu(shownItems, { nestAfterFirstGroup: Platform.OS === "ios" }),
    handleSelect,
  );
  return (
    <>
      <ThreadHeader {...headerProps} threadMenuItems={threadMenuItems} />
      {customSnoozeOpen ? (
        <CustomSnoozeSheet
          onClose={() => setCustomSnoozeOpen(false)}
          onSnooze={(snoozedUntil) => void actions.snoozeThread(thread, snoozedUntil)}
        />
      ) : null}
    </>
  );
}
