import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  effectiveSnoozed,
  QUEUED_TURN_START_GRACE_MS,
  snoozeBlocker,
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
import { useMenuButtonToggle } from "~/hooks/useMenuButtonToggle";
import type { ThreadQuickAction } from "~/hooks/useThreadActionMenu";
import { useThreadShell } from "../../state/entities";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type MenuPosition = { x: number; y: number };
/** Settles once the menu closes, so its button can tell a closing press from an opening one. */
type OpenMenu = (position: MenuPosition) => Promise<void> | undefined;

function menuPositionBelow(event: ReactMouseEvent<HTMLElement>): MenuPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 4 };
}

function withShortcut(label: string, shortcut: string | null) {
  return shortcut ? `${label} (${shortcut})` : label;
}

const SNOOZE_BLOCKED_LABEL = {
  "waiting-on-you": "Can't snooze while the thread is waiting on you",
  "guest-message": "Can't snooze while a guest message is waiting",
  "starting-turn": "Can't snooze while the thread is starting a turn",
} as const;

function HeaderActionButton(props: {
  readonly label: string;
  readonly tooltip?: string;
  readonly icon: LucideIcon;
  /** How the icon fills in when pressed, so on reads differently from hover. */
  readonly pressedIconClassName?: string;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly action: { readonly onClick: () => void } | { readonly onOpenMenu: OpenMenu };
}) {
  const Icon = props.icon;
  const menuToggle = useMenuButtonToggle();
  const { action } = props;
  const opensMenu = "onOpenMenu" in action;
  const onClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!opensMenu) return action.onClick();
    const position = menuPositionBelow(event);
    menuToggle.onClick(event, () => action.onOpenMenu(position));
  };
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
            aria-haspopup={opensMenu ? "menu" : undefined}
            data-pressed={props.pressed ? "" : undefined}
            // Not `disabled`: that drops pointer events, so the tooltip saying why could never show.
            aria-disabled={props.disabled || undefined}
            onPointerDown={opensMenu && !props.disabled ? menuToggle.onPointerDown : undefined}
            onClick={props.disabled ? undefined : onClick}
          />
        }
      >
        <Icon className={cn("size-4", props.pressed && props.pressedIconClassName)} />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.tooltip ?? props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** Sets the thread's own buttons apart from the panel toggles beside them. */
function HeaderGroupDivider() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />;
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
  readonly onOpenMenu: OpenMenu;
  readonly onOpenSnoozeMenu: OpenMenu;
  readonly onRunAction: (action: ThreadQuickAction) => Promise<void>;
}) {
  const thread = useThreadShell(props.threadRef);
  // A quick second click on one button would read the old state and undo the first.
  const [running, setRunning] = useState<ReadonlySet<ThreadQuickAction>>(new Set());
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
  const run = (button: ThreadQuickAction, action: ThreadQuickAction) => {
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
  const blocker = thread === null ? null : snoozeBlocker(thread, { now });
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
            // A solid disc with the check cut out, like the phone's filled checkmark.
            pressedIconClassName="[&_circle]:fill-current [&_path]:stroke-background"
            pressed={isSettled}
            action={{ onClick: () => run("settle", isSettled ? "unsettle" : "settle") }}
          />
          {isSnoozed ? (
            <HeaderActionButton
              label="Wake thread"
              icon={AlarmClockOffIcon}
              pressed
              action={{ onClick: () => run("unsnooze", "unsnooze") }}
            />
          ) : (
            <HeaderActionButton
              label="Snooze"
              tooltip={blocker === null ? "Snooze" : SNOOZE_BLOCKED_LABEL[blocker]}
              icon={ClockIcon}
              disabled={blocker !== null}
              action={{ onOpenMenu: props.onOpenSnoozeMenu }}
            />
          )}
          <HeaderActionButton
            label={isPinned ? "Unpin thread" : "Pin thread"}
            tooltip={withShortcut(isPinned ? "Unpin thread" : "Pin thread", props.pinShortcut)}
            icon={PinIcon}
            pressedIconClassName="fill-current"
            pressed={isPinned}
            action={{ onClick: () => run("pin", isPinned ? "unpin" : "pin") }}
          />
        </div>
      ) : null}
      <HeaderActionButton
        label="Thread actions"
        icon={EllipsisIcon}
        action={{ onOpenMenu: props.onOpenMenu }}
      />
      <HeaderGroupDivider />
    </div>
  );
}

/** ⋯ for a thread that hasn't been sent yet: the same choices its sidebar row offers. */
export function DraftHeaderActions(props: { readonly onOpenMenu: OpenMenu }) {
  return (
    <div className="flex shrink-0 items-center" data-thread-header-actions>
      <HeaderActionButton
        label="Draft actions"
        icon={EllipsisIcon}
        action={{ onOpenMenu: props.onOpenMenu }}
      />
      <HeaderGroupDivider />
    </div>
  );
}
