import { useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import {
  createContext,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/ui/AppText";
import { useToolbarLayout } from "../../components/ui/useToolbarLayout";
import { useHardwareBack } from "../../lib/backHandler";
import { MOBILE_MOTION } from "../../lib/designTokens";
import { WorkspaceTabsContext } from "../layout/workspace/WorkspaceTabsContext";
import { RightSwipeReservedContext } from "./thread-swipe-actions";

// Material's modal drawer: at most 360dp wide, leaving a strip beside it that closes it.
const MAX_DRAWER_WIDTH = 360;
const CLOSE_STRIP_WIDTH = 72;
const SCRIM_OPACITY = 0.45;
// A right swipe this long on the list starts pulling the drawer out.
const OPEN_DRAG_OFFSET = 16;
const FLING_VELOCITY = 500;
const TIMING = {
  duration: MOBILE_MOTION.enter + 50,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
};

interface PinnedThreadsDrawer {
  /** 0 closed, 1 open; follows the finger while dragged. */
  readonly progress: SharedValue<number>;
  readonly width: number;
  /** Open, opening or being dragged: the pinned list is mounted. */
  readonly shown: boolean;
  readonly open: () => void;
  readonly close: () => void;
  readonly beginDrag: () => void;
  readonly settle: (open: boolean) => void;
  readonly setContent: (owner: object, content: ReactNode) => void;
  readonly clearContent: (owner: object) => void;
}

const PinnedThreadsDrawerContext = createContext<PinnedThreadsDrawer | null>(null);

function createContentStore() {
  let owner: object | null = null;
  let content: ReactNode = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => content,
    set: (nextOwner: object, next: ReactNode) => {
      owner = nextOwner;
      content = next;
      emit();
    },
    clear: (previousOwner: object) => {
      if (owner !== previousOwner) return;
      owner = null;
      content = null;
      emit();
    },
  };
}

/**
 * Phone layout: pinned threads leave the thread list for a drawer that slides in from the left
 * over the whole workspace, its bars included. The list projects its pinned rows into it, so they
 * keep the list's actions.
 */
export function PinnedThreadsDrawerScope(props: {
  readonly enabled: boolean;
  readonly children: ReactNode;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(MAX_DRAWER_WIDTH, windowWidth - CLOSE_STRIP_WIDTH);
  const progress = useSharedValue(0);
  const [shown, setShown] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [store] = useState(createContentStore);
  // Stable actions: the list's pan gesture holds them, and a new config mid-drag would rebuild it.
  const actions = useMemo(() => {
    const hide = () => {
      setIsOpen(false);
      setShown(false);
    };
    const animateTo = (open: boolean) => {
      setIsOpen(open);
      progress.set(
        withTiming(open ? 1 : 0, TIMING, (finished) => {
          if (finished === true && !open) runOnJS(hide)();
        }),
      );
    };
    return {
      progress,
      open: () => {
        setShown(true);
        animateTo(true);
      },
      close: () => animateTo(false),
      beginDrag: () => setShown(true),
      settle: animateTo,
      setContent: store.set,
      clearContent: store.clear,
    };
  }, [progress, store]);
  const drawer = useMemo<PinnedThreadsDrawer>(
    () => ({ ...actions, width, shown }),
    [actions, width, shown],
  );
  const navigation = useNavigation();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a route opened over Home (a thread picked from the drawer) leaves the drawer closed underneath, without animating over the new page
  useEffect(
    () =>
      navigation.addListener("blur", () => {
        progress.set(0);
        setIsOpen(false);
        setShown(false);
      }),
    [navigation, progress],
  );
  useHardwareBack(props.enabled && isOpen, () => {
    drawer.close();
    return true;
  });
  // One tree whether or not it is enabled, so switching tabs keeps the panes mounted.
  return (
    <PinnedThreadsDrawerContext value={props.enabled ? drawer : null}>
      {props.children}
      {props.enabled && shown ? <DrawerPanel drawer={drawer} store={store} /> : null}
    </PinnedThreadsDrawerContext>
  );
}

function DrawerPanel(props: {
  readonly drawer: PinnedThreadsDrawer;
  readonly store: ReturnType<typeof createContentStore>;
}) {
  const gt = useGT();
  const { drawer, store } = props;
  const { progress, width, settle } = drawer;
  const content = useSyncExternalStore(store.subscribe, store.get, store.get);
  const insets = useSafeAreaInsets();
  const toolbar = useToolbarLayout();
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * SCRIM_OPACITY }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.value - 1) * width }],
  }));
  // Dragging the open drawer left pushes it back; the rows inside keep their own swipes.
  const closeGesture = usePanGesture({
    activeOffsetX: -12,
    failOffsetY: [-14, 14],
    onUpdate: (event) => {
      progress.set(Math.min(1, Math.max(0, 1 + event.translationX / width)));
    },
    onDeactivate: (event) => {
      const open = event.velocityX > -FLING_VELOCITY && progress.value > 0.5;
      runOnJS(settle)(open);
    },
  });
  return (
    <GestureDetector gesture={closeGesture}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, scrimStyle]}>
          <View className="flex-1 bg-black" />
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Close pinned threads")}
          onPress={drawer.close}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessibilityViewIsModal
          className="absolute top-0 bottom-0 left-0 bg-screen"
          style={[{ width, elevation: 16 }, panelStyle]}
        >
          <View
            className="justify-center bg-header px-5"
            style={{
              paddingTop: toolbar.paddingTop,
              paddingBottom: toolbar.paddingBottom,
              minHeight: toolbar.height + toolbar.paddingTop + toolbar.paddingBottom,
            }}
          >
            <AppText
              accessibilityRole="header"
              textRole="title"
              numberOfLines={1}
              className="text-header-foreground"
            >
              {gt("Pinned threads")}
            </AppText>
          </View>
          <View className="flex-1" style={{ paddingLeft: insets.left }}>
            {/* The drawer's list keeps its own scroll and search state, apart from the tab's. */}
            <WorkspaceTabsContext value={null}>{content}</WorkspaceTabsContext>
          </View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

export function usePinnedThreadsDrawer(): Pick<
  PinnedThreadsDrawer,
  "open" | "close" | "shown"
> | null {
  return use(PinnedThreadsDrawerContext);
}

/** Shows the pinned list in the drawer while it is out; renders nothing in place. */
export function PinnedThreadsDrawerContent(props: { readonly children: ReactNode }) {
  const drawer = use(PinnedThreadsDrawerContext);
  const [owner] = useState(() => ({}));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- projects the pinned list into the out-of-tree drawer after every commit
  useLayoutEffect(() => {
    drawer?.setContent(owner, props.children);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the drawer's content when the list unmounts
  useLayoutEffect(() => (drawer ? () => drawer.clearContent(owner) : undefined), [drawer, owner]);
  return null;
}

/**
 * The thread list's area: a left-to-right swipe that starts on it pulls the drawer out under the
 * finger. Rows give up that direction while closed (`RightSwipeReservedContext`).
 */
export function PinnedThreadsSwipeArea(props: { readonly children: ReactNode }) {
  const drawer = use(PinnedThreadsDrawerContext);
  const progress = drawer?.progress;
  const width = drawer?.width ?? 1;
  const beginDrag = drawer?.beginDrag;
  const settle = drawer?.settle;
  const gesture = usePanGesture({
    enabled: drawer !== null,
    activeOffsetX: OPEN_DRAG_OFFSET,
    failOffsetX: -12,
    failOffsetY: [-14, 14],
    onActivate: () => {
      if (beginDrag) runOnJS(beginDrag)();
    },
    onUpdate: (event) => {
      progress?.set(Math.min(1, Math.max(0, (event.translationX - OPEN_DRAG_OFFSET) / width)));
    },
    onDeactivate: (event) => {
      if (!settle || !progress) return;
      const open =
        !event.canceled &&
        (event.velocityX > FLING_VELOCITY ||
          (event.velocityX > -FLING_VELOCITY && progress.value > 0.35));
      runOnJS(settle)(open);
    },
  });
  return (
    <RightSwipeReservedContext value={drawer !== null}>
      <GestureDetector gesture={gesture}>
        <View collapsable={false} className="flex-1">
          {props.children}
        </View>
      </GestureDetector>
    </RightSwipeReservedContext>
  );
}
