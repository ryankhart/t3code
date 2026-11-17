import type { SubagentPillSegment } from "@t3tools/client-runtime/state/thread-subagents";
import { GlassContainer, GlassView } from "expo-glass-effect";
import { useGT } from "gt-react-native";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, Pressable, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { withUniwind } from "uniwind";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ControlPill } from "../../components/ui/ControlPill";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { BrowserPreviewButton } from "../browser/browser-preview-button";
import { DevicePreviewButton } from "../devices/device-preview-button";
import type { FloatingStatusAction, FloatingWorkingStatus } from "./floating-working-status";
import { ShimmeringWorkContent } from "./thread-work-log";

const CONTROL_HEIGHT = 38.5;
const CONTROL_GAP = 8;
const COMPOSER_CAPSULE_INSET = 6;
const GLASS_MERGE_SPACING = 12;
const CONTROL_ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const CONTROL_EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
const CONTROL_TIMING = {
  duration: 240,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
// Matches the row's `gap-4`, so slides land exactly centered.
const CONTROL_ROW_GAP = 16;
// Custom build: the "Bottom" pill's width before it has been measured.
const BOTTOM_ESTIMATED_WIDTH = 96;
const LABEL_ENTERING = FadeIn.duration(160).delay(80).reduceMotion(ReduceMotion.System);
const LABEL_EXITING = FadeOut.duration(100).reduceMotion(ReduceMotion.System);

// Expo reapplies glass after layout or reattachment, restoring material UIKit can lose behind visible labels.
const UniwindGlassView = withUniwind(GlassView, {
  style: { fromClassName: "className" },
});
const UniwindGlassContainer = withUniwind(GlassContainer, {
  style: { fromClassName: "className" },
});
const AnimatedGlassView = Animated.createAnimatedComponent(UniwindGlassView);

// Segment widths feed back into labelWidth; ignore sub-point changes to avoid rounding-driven ellipsis loops.
function settleWidth(next: number) {
  return (current: number) => (Math.abs(current - next) < 1 ? current : next);
}

const CONTROL_OVERLAY_OFFSET = CONTROL_HEIGHT + CONTROL_GAP - COMPOSER_CAPSULE_INSET;
export const FLOATING_WORKING_CONTROL_COVERAGE = CONTROL_OVERLAY_OFFSET + CONTROL_GAP;
/** Custom build: where this row sits, for the prompt jump buttons beside it. */
export const FLOATING_WORKING_CONTROL_ROW_TOP = -CONTROL_OVERLAY_OFFSET;
/** Custom build: the prompt jump buttons line up with the message box's right edge. */
export const PROMPT_JUMP_EDGE_INSET = 12;
export const PROMPT_JUMP_BUTTON_SIZE = 44;
export const PROMPT_JUMP_GAP = 8;
// Room the two jump buttons take at the right edge, plus a gap before the centered row.
const PROMPT_JUMP_CLUSTER =
  PROMPT_JUMP_EDGE_INSET + 2 * PROMPT_JUMP_BUTTON_SIZE + 2 * PROMPT_JUMP_GAP;
// Just the Previous slot. Without "Bottom" the chat is at its end, where Next never shows.
const PROMPT_JUMP_PREVIOUS_ONLY =
  PROMPT_JUMP_EDGE_INSET + PROMPT_JUMP_BUTTON_SIZE + PROMPT_JUMP_GAP;
/**
 * Custom build: without native glass, the floating controls' fallback material is ~94%
 * opaque, so chat text ghosted through. An opaque card colour underneath keeps the same
 * look while hiding the text.
 */
export const FLOATING_CONTROL_UNDERLAY = "rounded-full bg-card shadow-md shadow-black/10";
export const FLOATING_CONTROL_FALLBACK = "border border-border bg-glass-fallback";

export function FloatingWorkingControl(props: {
  readonly colorScheme: "light" | "dark";
  readonly status: FloatingWorkingStatus | null;
  readonly extensionStatus?: { readonly label: string; readonly onPress: () => void } | null;
  readonly devicePreview: { readonly count: number; readonly onPress: () => void } | null;
  readonly browserPreview: { readonly count: number; readonly onPress: () => void } | null;
  readonly showScrollToEnd: boolean;
  readonly onScrollToEnd: () => void;
  readonly agents: SubagentPillSegment | null;
  readonly onOpenAgents: () => void;
  readonly queuedCount: number;
  readonly onOpenQueue: () => void;
  readonly lift?: SharedValue<number>;
  /** Custom build: keep the row clear of the prompt jump buttons while they show. */
  readonly reserveSideControls?: boolean;
}) {
  const gt = useGT();
  const { width: windowWidth } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [overlayWidth, setOverlayWidth] = useState(windowWidth);
  const [queueWidth, setQueueWidth] = useState(0);
  const [actionWidth, setActionWidth] = useState(0);
  const [extensionWidth, setExtensionWidth] = useState(0);
  const extensionStatus = props.extensionStatus ?? null;
  const extensionOnly = props.status?.kind === "extension";
  const useGlass = NATIVE_LIQUID_GLASS_SUPPORTED && !extensionOnly;
  const actions: ReadonlyArray<FloatingStatusAction> =
    props.status?.kind === "goal"
      ? props.status.actions
      : props.status?.kind === "stop" && props.status.action !== null
        ? [props.status.action]
        : [];
  const [agentsWidth, setAgentsWidth] = useState(0);
  const hasQueue = props.queuedCount > 0;
  const hasPreview = props.devicePreview !== null || props.browserPreview !== null;
  const [previewWidth, setPreviewWidth] = useState(0);
  const agents = props.agents;
  const hasAgents = agents !== null;
  const hasStatus = props.status !== null;
  const hasCapsule = hasStatus || hasQueue || hasAgents || hasPreview;
  const [bottomWidth, setBottomWidth] = useState(BOTTOM_ESTIMATED_WIDTH);
  // Custom build: "Bottom" alone stays centered. With a status beside it, the pair centers
  // in the room left of the jump buttons, so the status label keeps enough width to read.
  const shiftForJumpButtons =
    props.reserveSideControls === true && hasCapsule && props.showScrollToEnd;
  const jumpButtonReserve = !props.reserveSideControls
    ? 0
    : shiftForJumpButtons
      ? PROMPT_JUMP_CLUSTER
      : 2 * PROMPT_JUMP_PREVIOUS_ONLY;
  // Only reserve the scroll button's slot while it is visible.
  const reservedWidth = (props.showScrollToEnd ? bottomWidth + 32 : 16) + jumpButtonReserve;
  const availableLabelWidth = Math.max(
    0,
    Math.min(overlayWidth, windowWidth) -
      reservedWidth -
      (actions.length > 0 ? actionWidth : 0) -
      (hasQueue ? queueWidth : 0) -
      (hasAgents ? agentsWidth : 0) -
      (hasPreview ? previewWidth : 0),
  );
  const labelWidth = Math.max(
    0,
    availableLabelWidth - (extensionStatus === null ? 0 : extensionWidth),
  );
  const separationProgress = useSharedValue(props.showScrollToEnd ? 1 : 0);
  const separation = useSharedValue((CONTROL_ROW_GAP + BOTTOM_ESTIMATED_WIDTH) / 2);
  const jumpShiftProgress = useSharedValue(shiftForJumpButtons ? 1 : 0);
  const handleBottomLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    // Same sub-point settling as the labels, for both the reserve and the slide.
    if (width <= 0 || Math.abs(width - bottomWidth) < 1) return;
    setBottomWidth(width);
    separation.set((CONTROL_ROW_GAP + width) / 2);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- animates the Reanimated shift that keeps the status clear of the jump buttons
  useEffect(() => {
    jumpShiftProgress.set(withTiming(shiftForJumpButtons ? 1 : 0, CONTROL_TIMING));
  }, [shiftForJumpButtons, jumpShiftProgress]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- animates the Reanimated separation value when scroll-to-end visibility changes
  useEffect(() => {
    separationProgress.set(withTiming(props.showScrollToEnd ? 1 : 0, CONTROL_TIMING));
  }, [props.showScrollToEnd, separationProgress]);

  const lift = props.lift;
  const liftStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -(lift?.value ?? 0) },
      { translateX: (-PROMPT_JUMP_CLUSTER / 2) * jumpShiftProgress.value },
    ],
  }));
  const arrowTransformStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -separation.value * (1 - separationProgress.value) }],
  }));
  const arrowContentStyle = useAnimatedStyle(() => ({
    opacity: separationProgress.value,
  }));

  // Animate an in-flow sizer for native glass layout. Measure labels at fixed width to avoid repeated animation retargeting.
  const capsuleWidth = useSharedValue<number | null>(null);
  const measuredWidthRef = useRef<number | null>(null);
  const handleLabelLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width === measuredWidthRef.current) {
      return;
    }
    const first = measuredWidthRef.current === null;
    measuredWidthRef.current = width;
    capsuleWidth.set(first ? width : withTiming(width, CONTROL_TIMING));
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the Reanimated capsule width value and measured width when the status goes away
  useEffect(() => {
    if (!hasStatus) {
      measuredWidthRef.current = null;
      capsuleWidth.set(null);
    }
  }, [capsuleWidth, hasStatus]);
  const capsuleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: separation.value * (1 - separationProgress.value) }],
  }));
  const capsuleSizerStyle = useAnimatedStyle(() => ({
    width: capsuleWidth.value ?? 0,
  }));

  if (!hasCapsule && !props.showScrollToEnd) {
    return null;
  }

  const previewCompact =
    hasStatus ||
    hasAgents ||
    hasQueue ||
    (props.devicePreview !== null && props.browserPreview !== null);
  const statusInteractive =
    props.status?.kind === "connection" ||
    props.status?.kind === "extension" ||
    props.status?.kind === "child-input";
  const capsuleInteractive =
    statusInteractive ||
    extensionStatus !== null ||
    actions.length > 0 ||
    hasQueue ||
    hasAgents ||
    hasPreview;
  const statusContent =
    props.status !== null ? (
      <View
        pointerEvents={statusInteractive ? "box-none" : "none"}
        className="h-11 items-center justify-center overflow-hidden"
      >
        <Animated.View className="h-11" style={capsuleSizerStyle} />
        <View
          pointerEvents={statusInteractive ? "box-none" : "none"}
          className="absolute h-11 items-center justify-center"
          style={{ width: labelWidth }}
        >
          <FloatingStatusLabel
            key={
              props.status.kind === "extension"
                ? props.status.kind
                : `${props.status.kind}:${props.status.label}`
            }
            status={props.status}
            onLayout={handleLabelLayout}
          />
        </View>
      </View>
    ) : null;

  const capsuleContent = (
    <View className="flex-row items-center">
      {statusContent}
      {extensionStatus !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={extensionStatus.label}
          accessibilityHint={gt("Shows the full Pi status")}
          onPress={extensionStatus.onPress}
          onLayout={(event) => setExtensionWidth(settleWidth(event.nativeEvent.layout.width))}
          style={{ maxWidth: availableLabelWidth * 0.5 }}
          className="h-11 flex-row items-center px-3 active:opacity-70"
        >
          {hasStatus ? <View className="absolute left-0 h-4 w-px bg-border" /> : null}
          <Text className="shrink font-t3-medium text-xs text-foreground" numberOfLines={1}>
            {extensionStatus.label}
          </Text>
        </Pressable>
      ) : null}
      {actions.length > 0 ? (
        <View
          onLayout={(event) => setActionWidth(settleWidth(event.nativeEvent.layout.width))}
          className="h-11 flex-row items-center"
        >
          {actions.map((action) => (
            <Fragment key={action.label}>
              <View className="h-4 w-px bg-border" />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={action.accessibilityLabel}
                accessibilityState={{ disabled: action.disabled }}
                disabled={action.disabled}
                onPress={action.onPress}
                className={`h-11 items-center justify-center px-3 active:opacity-70 ${action.disabled ? "opacity-50" : ""}`}
              >
                <Text className="font-t3-medium text-xs text-foreground" numberOfLines={1}>
                  {action.label}
                </Text>
              </Pressable>
            </Fragment>
          ))}
        </View>
      ) : null}
      {hasPreview ? (
        <View
          className="h-11 flex-row items-center"
          onLayout={(event) => setPreviewWidth(settleWidth(event.nativeEvent.layout.width))}
        >
          {hasStatus ? <View className="h-4 w-px bg-border" /> : null}
          {props.devicePreview !== null ? (
            <DevicePreviewButton {...props.devicePreview} compact={previewCompact} />
          ) : null}
          {props.browserPreview !== null ? (
            <BrowserPreviewButton {...props.browserPreview} compact={previewCompact} />
          ) : null}
        </View>
      ) : null}
      {agents !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Open agents, {agents}", { agents: agents.accessibilityLabel })}
          accessibilityHint={gt("Opens this turn's subagents")}
          onPress={props.onOpenAgents}
          onLayout={(event) => setAgentsWidth(settleWidth(event.nativeEvent.layout.width))}
          className="h-11 flex-row items-center gap-1.5 px-3 active:opacity-70"
        >
          {hasStatus || hasPreview ? <View className="absolute left-0 h-4 w-px bg-border" /> : null}
          <SymbolView name="person.2" size={13} tintColorClassName="accent-foreground" />
          <Text className="font-t3-medium text-xs tabular-nums" numberOfLines={1}>
            {agents.label}
          </Text>
        </Pressable>
      ) : null}
      {hasQueue ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("{count, plural, other {Open queue, {count} messages}}", {
            count: props.queuedCount,
          })}
          accessibilityHint={gt("Opens queued messages to send now, edit, or remove")}
          onPress={props.onOpenQueue}
          onLayout={(event) => setQueueWidth(settleWidth(event.nativeEvent.layout.width))}
          style={{ maxWidth: Math.min(overlayWidth, windowWidth) * 0.45 }}
          className="h-11 flex-row items-center gap-2 px-3 active:opacity-70"
        >
          {hasStatus || hasPreview || hasAgents ? (
            <View className="absolute left-0 h-4 w-px bg-border" />
          ) : null}
          <SymbolView name="list.number" size={13} tintColorClassName="accent-foreground" />
          <Text className="shrink font-t3-medium text-xs tabular-nums" numberOfLines={1}>
            {gt("{count, plural, other {{count} queued}}", { count: props.queuedCount })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <Animated.View
      pointerEvents="box-none"
      className="absolute left-0 right-0 z-20 items-center"
      style={[{ top: -CONTROL_OVERLAY_OFFSET }, liftStyle]}
      onLayout={(event) => setOverlayWidth(event.nativeEvent.layout.width)}
      entering={useGlass || extensionOnly || reducedMotion ? undefined : CONTROL_ENTERING}
      exiting={useGlass || extensionOnly || reducedMotion ? undefined : CONTROL_EXITING}
    >
      {hasCapsule && useGlass ? (
        <UniwindGlassContainer
          spacing={GLASS_MERGE_SPACING}
          pointerEvents="box-none"
          className="flex-row items-center gap-4"
        >
          <AnimatedGlassView
            colorScheme={props.colorScheme}
            glassEffectStyle="regular"
            isInteractive={capsuleInteractive}
            pointerEvents={capsuleInteractive ? "box-none" : "none"}
            className="h-11 items-center justify-center overflow-hidden rounded-full"
            style={capsuleStyle}
          >
            {capsuleContent}
          </AnimatedGlassView>

          <AnimatedGlassView
            colorScheme={props.colorScheme}
            glassEffectStyle={{ style: props.showScrollToEnd ? "regular" : "none", animate: true }}
            isInteractive
            pointerEvents={props.showScrollToEnd ? "auto" : "none"}
            accessibilityElementsHidden={!props.showScrollToEnd}
            importantForAccessibility={props.showScrollToEnd ? "auto" : "no-hide-descendants"}
            className="h-11 items-center justify-center overflow-hidden rounded-full"
            style={arrowTransformStyle}
            onLayout={handleBottomLayout}
          >
            <Animated.View style={arrowContentStyle}>
              <ScrollToEndButton disabled={!props.showScrollToEnd} onPress={props.onScrollToEnd} />
            </Animated.View>
          </AnimatedGlassView>
        </UniwindGlassContainer>
      ) : hasCapsule ? (
        <View pointerEvents="box-none" className="flex-row items-center gap-4">
          <Animated.View
            pointerEvents={capsuleInteractive ? "box-none" : "none"}
            className="h-11 items-center justify-center overflow-hidden rounded-full border border-border bg-card shadow-md shadow-black/10"
            style={capsuleStyle}
          >
            <View pointerEvents="none" className="absolute inset-0 bg-glass-fallback" />
            {capsuleContent}
          </Animated.View>

          <Animated.View
            pointerEvents={props.showScrollToEnd ? "auto" : "none"}
            accessibilityElementsHidden={!props.showScrollToEnd}
            importantForAccessibility={props.showScrollToEnd ? "auto" : "no-hide-descendants"}
            style={[arrowTransformStyle, arrowContentStyle]}
            onLayout={handleBottomLayout}
          >
            <View className={FLOATING_CONTROL_UNDERLAY}>
              <ControlPill
                {...BOTTOM_PILL}
                className={`${BOTTOM_PILL_CLASS} ${FLOATING_CONTROL_FALLBACK}`}
                disabled={!props.showScrollToEnd}
                onPress={props.onScrollToEnd}
              />
            </View>
          </Animated.View>
        </View>
      ) : NATIVE_LIQUID_GLASS_SUPPORTED ? (
        <UniwindGlassView
          colorScheme={props.colorScheme}
          glassEffectStyle="regular"
          isInteractive
          className="h-11 items-center justify-center overflow-hidden rounded-full"
          onLayout={handleBottomLayout}
        >
          <ScrollToEndButton onPress={props.onScrollToEnd} />
        </UniwindGlassView>
      ) : (
        <View className={FLOATING_CONTROL_UNDERLAY} onLayout={handleBottomLayout}>
          <ControlPill
            {...BOTTOM_PILL}
            className={`${BOTTOM_PILL_CLASS} ${FLOATING_CONTROL_FALLBACK}`}
            onPress={props.onScrollToEnd}
          />
        </View>
      )}
    </Animated.View>
  );
}

function FloatingStatusLabel(props: {
  readonly status: FloatingWorkingStatus;
  readonly onLayout: (event: LayoutChangeEvent) => void;
}) {
  if (props.status.kind === "extension") {
    return (
      <StatusLabelRow
        accessibilityLabel={props.status.label}
        accessibilityRole="button"
        onPress={props.status.onPress}
        onLayout={props.onLayout}
        className="gap-1.5"
        animated={false}
      >
        <Text className="shrink font-t3-medium text-xs text-foreground" numberOfLines={1}>
          {props.status.label}
        </Text>
        <SymbolView name="chevron.down" size={10} tintColorClassName="accent-foreground" />
      </StatusLabelRow>
    );
  }
  if (props.status.kind === "child-input") {
    return (
      <StatusLabelRow
        key="child-input"
        accessibilityLabel={props.status.accessibilityLabel}
        accessibilityRole="button"
        className="gap-2"
        onLayout={props.onLayout}
        onPress={props.status.onPress}
      >
        <SymbolView name="text.bubble" size={13} tintColorClassName="accent-foreground" />
        <Text className="shrink font-t3-medium text-xs text-foreground" numberOfLines={1}>
          {props.status.label}
        </Text>
      </StatusLabelRow>
    );
  }
  if (props.status.kind === "connection") {
    return (
      <StatusLabelRow
        key="connection"
        accessibilityLabel={props.status.label}
        accessibilityRole="button"
        className="gap-2"
        onLayout={props.onLayout}
        onPress={props.status.onPress}
      >
        <View className="h-2 w-2 rounded-full bg-red-500" />
        <Text
          className="max-w-[260px] shrink font-t3-medium text-xs text-foreground"
          numberOfLines={1}
        >
          {props.status.label}
        </Text>
      </StatusLabelRow>
    );
  }
  if (props.status.kind === "stop") {
    return (
      <StatusLabelRow
        key="stop"
        accessibilityLabel={props.status.label}
        className="gap-2"
        onLayout={props.onLayout}
      >
        {props.status.unresponsive ? (
          <SymbolView
            name="exclamationmark.triangle"
            size={13}
            tintColorClassName="accent-warning-foreground"
            type="monochrome"
          />
        ) : (
          <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
        )}
        <Text className="shrink font-t3-medium text-xs text-foreground" numberOfLines={1}>
          {props.status.label}
        </Text>
      </StatusLabelRow>
    );
  }
  if (props.status.kind === "goal") {
    return (
      <StatusLabelRow
        key="goal"
        accessibilityLabel={props.status.accessibilityLabel}
        className="gap-2"
        onLayout={props.onLayout}
      >
        <SymbolView
          name="target"
          size={13}
          tintColorClassName="accent-foreground"
          type="monochrome"
        />
        <Text className="shrink font-t3-medium text-xs text-foreground" numberOfLines={1}>
          {props.status.label}
        </Text>
      </StatusLabelRow>
    );
  }
  return (
    <StatusLabelRow
      key="preparing"
      accessibilityLabel={props.status.label}
      className="gap-1.5"
      onLayout={props.onLayout}
    >
      <SymbolView
        name="arrow.triangle.branch"
        size={13}
        tintColorClassName="accent-foreground"
        type="monochrome"
      />
      <ShimmeringWorkContent
        className="flex-none"
        textClassName="font-t3-medium"
        compact
        icon="arrow.triangle.branch"
        iconSubtleColor="transparent"
        label={props.status.label}
        showIcon={false}
      />
    </StatusLabelRow>
  );
}

function StatusLabelRow(props: {
  readonly animated?: boolean;
  readonly accessibilityLabel?: string;
  readonly accessibilityRole?: "button";
  readonly className?: string;
  readonly children: ReactNode;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly onPress?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const rowClassName = `h-11 flex-row items-center px-4 ${props.className ?? ""}`;
  return (
    <Animated.View
      className="absolute max-w-full"
      entering={props.animated === false || reducedMotion ? undefined : LABEL_ENTERING}
      exiting={props.animated === false || reducedMotion ? undefined : LABEL_EXITING}
      onLayout={props.onLayout}
    >
      {props.onPress ? (
        <Pressable
          accessibilityLabel={props.accessibilityLabel}
          accessibilityRole={props.accessibilityRole}
          className={`${rowClassName} active:opacity-70`}
          onPress={props.onPress}
        >
          {props.children}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={props.accessibilityLabel} className={rowClassName}>
          {props.children}
        </View>
      )}
    </Animated.View>
  );
}

// Custom build: a labelled "Bottom" pill, so it reads apart from the "Next prompt" arrow.
const BOTTOM_PILL = {
  accessibilityLabel: "Scroll to bottom",
  activateOnPressIn: true,
  icon: { ios: "arrow.down.to.line", android: "vertical_align_bottom" },
  label: "Bottom",
  variant: "pill",
} as const;
const BOTTOM_PILL_CLASS = "h-11 pl-3.5 pr-4";

function ScrollToEndButton(props: { readonly disabled?: boolean; readonly onPress: () => void }) {
  return (
    <ControlPill
      {...BOTTOM_PILL}
      className={`${BOTTOM_PILL_CLASS} bg-transparent`}
      disabled={props.disabled}
      onPress={props.onPress}
    />
  );
}
