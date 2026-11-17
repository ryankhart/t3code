import { GlassView } from "expo-glass-effect";
import { View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";

import type { AppSymbolName } from "../../components/ui/AppSymbol";
import { ControlPill } from "../../components/ui/ControlPill";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import {
  FLOATING_CONTROL_FALLBACK,
  FLOATING_CONTROL_UNDERLAY,
  FLOATING_WORKING_CONTROL_ROW_TOP,
  PROMPT_JUMP_BUTTON_SIZE,
  PROMPT_JUMP_EDGE_INSET,
  PROMPT_JUMP_GAP,
} from "./floating-working-control";

const ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
// `h-11 w-11` is PROMPT_JUMP_BUTTON_SIZE (44), which the row's reserve is built from.
const BUTTON_CLASS = "h-11 w-11";

/**
 * Custom build: "Next prompt" and "Previous prompt" walk the chat one prompt per tap.
 * They sit at the right edge, level with the working status and "Bottom", which keep
 * clear of them. Each has a fixed slot, so one hiding never moves the other.
 */
export function PromptJumpButtons(props: {
  readonly colorScheme: "light" | "dark";
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly lift?: SharedValue<number>;
}) {
  const lift = props.lift;
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(lift?.value ?? 0) }],
  }));
  return (
    <>
      {props.canGoForward ? (
        <PromptJumpButton
          colorScheme={props.colorScheme}
          label="Next prompt"
          icon={{ ios: "chevron.down", android: "keyboard_arrow_down" }}
          right={PROMPT_JUMP_EDGE_INSET + PROMPT_JUMP_BUTTON_SIZE + PROMPT_JUMP_GAP}
          liftStyle={liftStyle}
          onPress={props.onNext}
        />
      ) : null}
      {props.canGoBack ? (
        <PromptJumpButton
          colorScheme={props.colorScheme}
          label="Previous prompt"
          icon={{ ios: "chevron.up", android: "keyboard_arrow_up" }}
          right={PROMPT_JUMP_EDGE_INSET}
          liftStyle={liftStyle}
          onPress={props.onPrevious}
        />
      ) : null}
    </>
  );
}

function PromptJumpButton(props: {
  readonly colorScheme: "light" | "dark";
  readonly label: string;
  readonly icon: AppSymbolName;
  readonly right: number;
  readonly liftStyle: ReturnType<typeof useAnimatedStyle>;
  readonly onPress: () => void;
}) {
  return (
    <Animated.View
      pointerEvents="box-none"
      className="absolute z-20"
      style={[{ top: FLOATING_WORKING_CONTROL_ROW_TOP, right: props.right }, props.liftStyle]}
      entering={ENTERING}
      exiting={EXITING}
    >
      {NATIVE_LIQUID_GLASS_SUPPORTED ? (
        <GlassView
          colorScheme={props.colorScheme}
          glassEffectStyle="regular"
          isInteractive
          style={{
            width: PROMPT_JUMP_BUTTON_SIZE,
            height: PROMPT_JUMP_BUTTON_SIZE,
            borderRadius: PROMPT_JUMP_BUTTON_SIZE / 2,
            overflow: "hidden",
          }}
        >
          <ControlPill
            accessibilityLabel={props.label}
            activateOnPressIn
            className={`${BUTTON_CLASS} bg-transparent`}
            icon={props.icon}
            onPress={props.onPress}
          />
        </GlassView>
      ) : (
        <View className={FLOATING_CONTROL_UNDERLAY}>
          <ControlPill
            accessibilityLabel={props.label}
            activateOnPressIn
            className={`${BUTTON_CLASS} ${FLOATING_CONTROL_FALLBACK}`}
            icon={props.icon}
            onPress={props.onPress}
          />
        </View>
      )}
    </Animated.View>
  );
}
