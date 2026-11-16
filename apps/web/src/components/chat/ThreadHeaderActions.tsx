import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ThreadActionMenuId } from "@t3tools/client-runtime/thread-action-menu";
import {
  canSnooze,
  effectiveSnoozed,
  QUEUED_TURN_START_GRACE_MS,
} from "@t3tools/client-runtime/state/thread-settled";
import {
  AlarmClockOffIcon,
  CircleCheckIcon,
  ClockIcon,
  EllipsisIcon,
  PinIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";

import { useNowAfter } from "~/hooks/useDeadline";
import { useThreadShell } from "../../state/entities";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type MenuPosition = { x: number; y: number };
type ThreadShell = NonNullable<ReturnType<typeof useThreadShell>>;

function menuPositionBelow(event: ReactMouseEvent<HTMLElement>): MenuPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 4 };
}

function withShortcut(label: string, shortcut: string | null) {
  return shortcut ? `${label} (${shortcut})` : label;
}

/** Why `canSnooze` said no, in the order it checks. */
function snoozeBlockedReason(thread: ThreadShell): string {
  const request = thread.source?.pendingRuntimeRequest;
  if (
    thread.hasPendingApprovals ||
    (request != null && request.kind !== "user_input") ||
    thread.pendingSubagentRequest != null
  ) {
    return "Can't snooze while the thread is waiting on you";
  }
  if ((thread.pendingGuestMessageCount ?? 0) > 0) {
    return "Can't snooze while a guest message is waiting";
  }
  return "Can't snooze while the thread is starting a turn";
}

function HeaderActionButton(props: {
  readonly label: string;
  readonly tooltip?: string;
  readonly icon: LucideIcon;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly opensMenu?: boolean;
  readonly onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const Icon = props.icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label={props.label}
            aria-pressed={props.pressed}
            aria-haspopup={props.opensMenu ? "menu" : undefined}
            data-pressed={props.pressed ? "" : undefined}
            // Not `disabled`: that drops pointer events, so the tooltip saying why could never show.
            aria-disabled={props.disabled || undefined}
            onClick={props.disabled ? undefined : props.onClick}
          />
        }
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.tooltip ?? props.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The thread header's own controls, so a thread is fully usable with the sidebar closed: Settle,
 * Snooze and Pin show their state and act in one click, and ⋯ opens the sidebar's full thread menu.
 */
export function ThreadHeaderActions(props: {
  readonly threadRef: ScopedThreadRef;
  readonly canOperate: boolean;
  readonly configLoaded: boolean;
  readonly settleShortcut: string | null;
  readonly pinShortcut: string | null;
  readonly onOpenMenu: (position: MenuPosition) => void;
  readonly onOpenSnoozeMenu: (position: MenuPosition) => void;
  readonly onRunAction: (action: ThreadActionMenuId) => Promise<void>;
}) {
  const thread = useThreadShell(props.threadRef);
  // A quick second click on one button would read the old state and undo the first.
  const [running, setRunning] = useState<ReadonlySet<ThreadActionMenuId>>(new Set());
  // Snoozing and its gate both change with time, so re-read the clock when each one flips.
  const snoozeEndsAt = Date.parse(thread?.snoozedUntil ?? "");
  const queuedTurnGateEndsAt = Date.parse(thread?.latestUserMessageAt ?? "");
  const nowMs = Math.max(
    useNowAfter(Number.isFinite(snoozeEndsAt) ? snoozeEndsAt + 1 : null),
    useNowAfter(
      Number.isFinite(queuedTurnGateEndsAt)
        ? queuedTurnGateEndsAt + QUEUED_TURN_START_GRACE_MS + 1
        : null,
    ),
  );
  const run = (button: ThreadActionMenuId, action: ThreadActionMenuId) => {
    if (running.has(button)) return;
    setRunning((current) => new Set(current).add(button));
    void props.onRunAction(action).finally(() =>
      setRunning((current) => {
        const next = new Set(current);
        next.delete(button);
        return next;
      }),
    );
  };
  const now = new Date(nowMs).toISOString();
  const showsQuickActions = thread !== null && props.canOperate && props.configLoaded;
  const isSettled = thread?.settledOverride === "settled";
  const isPinned = thread?.pinnedAt != null;
  const isSnoozed = thread !== null && effectiveSnoozed(thread, { now });
  const snoozable = thread !== null && canSnooze(thread, { now });
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-thread-header-actions>
      {showsQuickActions ? (
        // Narrow windows keep the room for the title; ⋯ still has every action.
        <div className="hidden items-center gap-0.5 sm:flex">
          <HeaderActionButton
            label={isSettled ? "Un-settle thread" : "Settle thread"}
            tooltip={withShortcut(
              isSettled ? "Un-settle thread" : "Settle thread",
              props.settleShortcut,
            )}
            icon={CircleCheckIcon}
            pressed={isSettled}
            onClick={() => run("settle", isSettled ? "unsettle" : "settle")}
          />
          {isSnoozed ? (
            <HeaderActionButton
              label="Wake thread"
              icon={AlarmClockOffIcon}
              pressed
              onClick={() => run("unsnooze", "unsnooze")}
            />
          ) : (
            <HeaderActionButton
              label="Snooze"
              tooltip={snoozable || thread === null ? "Snooze" : snoozeBlockedReason(thread)}
              icon={ClockIcon}
              opensMenu
              disabled={!snoozable}
              onClick={(event) => props.onOpenSnoozeMenu(menuPositionBelow(event))}
            />
          )}
          <HeaderActionButton
            label={isPinned ? "Unpin thread" : "Pin thread"}
            tooltip={withShortcut(isPinned ? "Unpin thread" : "Pin thread", props.pinShortcut)}
            icon={PinIcon}
            pressed={isPinned}
            onClick={() => run("pin", isPinned ? "unpin" : "pin")}
          />
        </div>
      ) : null}
      <HeaderActionButton
        label="Thread actions"
        icon={EllipsisIcon}
        opensMenu
        onClick={(event) => props.onOpenMenu(menuPositionBelow(event))}
      />
    </div>
  );
}

/** ⋯ for a thread that hasn't been sent yet: the same choices its sidebar row offers. */
export function DraftHeaderActions(props: {
  readonly onOpenMenu: (position: MenuPosition) => void;
}) {
  return (
    <div className="flex shrink-0 items-center" data-thread-header-actions>
      <HeaderActionButton
        label="Draft actions"
        icon={EllipsisIcon}
        opensMenu
        onClick={(event) => props.onOpenMenu(menuPositionBelow(event))}
      />
    </div>
  );
}
