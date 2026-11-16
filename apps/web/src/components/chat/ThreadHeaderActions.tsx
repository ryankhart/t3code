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
import type { MouseEvent as ReactMouseEvent } from "react";

import { useNowAfter } from "~/hooks/useDeadline";
import { useThreadShell } from "../../state/entities";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type MenuPosition = { x: number; y: number };

function menuPositionBelow(event: ReactMouseEvent<HTMLElement>): MenuPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 4 };
}

function HeaderActionButton(props: {
  readonly label: string;
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
            className="shrink-0 [-webkit-app-region:no-drag]"
            aria-label={props.label}
            aria-pressed={props.pressed}
            aria-haspopup={props.opensMenu ? "menu" : undefined}
            data-pressed={props.pressed ? "" : undefined}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
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
  readonly onOpenMenu: (position: MenuPosition) => void;
  readonly onOpenSnoozeMenu: (position: MenuPosition) => void;
  readonly onRunAction: (action: ThreadActionMenuId) => void;
}) {
  const thread = useThreadShell(props.threadRef);
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
  const showsQuickActions = thread !== null && props.canOperate && props.configLoaded;
  const now = new Date(nowMs).toISOString();
  const isSettled = thread?.settledOverride === "settled";
  const isPinned = thread?.pinnedAt != null;
  const isSnoozed = thread !== null && effectiveSnoozed(thread, { now });
  const snoozable = thread !== null && canSnooze(thread, { now });
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-thread-header-actions>
      {showsQuickActions ? (
        <>
          <HeaderActionButton
            label={isSettled ? "Un-settle thread" : "Settle thread"}
            icon={CircleCheckIcon}
            pressed={isSettled}
            onClick={() => props.onRunAction(isSettled ? "unsettle" : "settle")}
          />
          {isSnoozed ? (
            <HeaderActionButton
              label="Wake thread"
              icon={AlarmClockOffIcon}
              pressed
              onClick={() => props.onRunAction("unsnooze")}
            />
          ) : (
            <HeaderActionButton
              label={snoozable ? "Snooze" : "Snooze is unavailable while the thread is busy"}
              icon={ClockIcon}
              opensMenu
              disabled={!snoozable}
              onClick={(event) => props.onOpenSnoozeMenu(menuPositionBelow(event))}
            />
          )}
          <HeaderActionButton
            label={isPinned ? "Unpin thread" : "Pin thread"}
            icon={PinIcon}
            pressed={isPinned}
            onClick={() => props.onRunAction(isPinned ? "unpin" : "pin")}
          />
        </>
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
