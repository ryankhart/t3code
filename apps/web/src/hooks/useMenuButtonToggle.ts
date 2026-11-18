import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent } from "react";

// A native menu reports its close over IPC, so it can land just before the press that closed it.
const CLOSED_BY_THIS_PRESS_MS = 300;

/**
 * Lets a button that opens a menu close it again. The press that dismisses the menu (the in-page
 * menu on pointerdown, a native one as the OS closes it) still clicks the button, which would
 * otherwise open the menu straight back up.
 */
export function useMenuButtonToggle() {
  const open = useRef(false);
  const closedAt = useRef(Number.NEGATIVE_INFINITY);
  const swallowClick = useRef(false);
  return {
    onPointerDown: (event: PointerEvent) => {
      swallowClick.current =
        event.button === 0 &&
        (open.current || event.timeStamp - closedAt.current < CLOSED_BY_THIS_PRESS_MS);
    },
    onClick: (event: ReactMouseEvent, showMenu: () => Promise<void> | undefined) => {
      // Keyboard activation has no press to swallow.
      if (swallowClick.current && event.detail !== 0) {
        swallowClick.current = false;
        return;
      }
      swallowClick.current = false;
      const shown = showMenu();
      if (!shown) return;
      open.current = true;
      void shown.finally(() => {
        open.current = false;
        closedAt.current = performance.now();
      });
    },
  };
}
