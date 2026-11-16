import type { MenuAction } from "@react-native-menu/menu";
import type { ContextMenuItem } from "@t3tools/contracts";

// SF Symbol names; AppSymbol maps each to its Android icon.
const SYMBOL_BY_ACTION_ID: Readonly<Record<string, string>> = {
  find: "magnifyingglass",
  "new-thread-on-branch": "square.and.pencil",
  pin: "pin",
  unpin: "pin.slash",
  settle: "checkmark",
  unsettle: "arrow.uturn.backward",
  snooze: "clock",
  unsnooze: "clock",
  arrange: "line.3.horizontal",
  "move-up": "arrow.up",
  "move-down": "arrow.down",
  rename: "pencil",
  "regenerate-title": "arrow.clockwise",
  "mark-unread": "circle.fill",
  "share-guest": "person.badge.plus",
  "filter-by-project": "line.3.horizontal.decrease",
  "turn-into-project": "folder.badge.plus",
  "move-to-project": "folder.fill",
  "auto-settle": "timer",
  copy: "doc.on.doc",
  "copy-path": "folder",
  "copy-branch": "arrow.triangle.branch",
  "copy-thread": "text.bubble",
  "copy-thread-id": "doc.on.doc",
  "project-settings": "gearshape",
  archive: "archivebox",
  delete: "trash",
  discard: "trash",
};

function menuAction(item: ContextMenuItem<string>): MenuAction {
  const image = SYMBOL_BY_ACTION_ID[item.id];
  const attributes =
    item.disabled || item.destructive
      ? {
          ...(item.disabled ? { disabled: true } : {}),
          ...(item.destructive ? { destructive: true } : {}),
        }
      : undefined;
  return {
    id: item.id,
    title: item.label,
    ...(item.detail ? { subtitle: item.detail } : {}),
    ...(image ? { image } : {}),
    ...(attributes ? { attributes } : {}),
    ...(item.checked === undefined ? {} : { state: item.checked ? "on" : "off" }),
    ...(item.children && item.children.length > 0
      ? {
          // Some phone menus still open a disabled submenu, so its choices carry the state too.
          subactions: item.children.map((child) =>
            menuAction(item.disabled ? { ...child, disabled: true } : child),
          ),
        }
      : {}),
  };
}

/**
 * The shared thread menu as phone menu actions, in the same order as desktop. Phones have no
 * separators, so groups simply follow one another. iOS keeps only the first group at the top and
 * puts the rest under More: UIKit scrolls a taller menu, and that scroll cancels press-drag-release.
 */
export function menuActionsFromThreadMenu(
  items: ReadonlyArray<ContextMenuItem<string>>,
  options: { readonly nestAfterFirstGroup: boolean },
): MenuAction[] {
  const actions = items.map(menuAction);
  if (!options.nestAfterFirstGroup) return actions;
  const firstSeparator = items.findIndex((item, index) => index > 0 && item.separatorBefore);
  if (firstSeparator === -1) return actions;
  return [
    ...actions.slice(0, firstSeparator),
    {
      id: "more",
      title: "More",
      image: "ellipsis.circle",
      subactions: actions.slice(firstSeparator),
    },
  ];
}
