import { GlassView } from "expo-glass-effect";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";

import { ControlPill } from "../../components/ui/ControlPill";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { FLOATING_WORKING_CONTROL_ROW_TOP } from "./floating-working-control";

const ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
// Lines the button up with the message box's right edge (measured on Android).
const MESSAGE_BOX_EDGE_INSET = 12;

/**
 * Custom build: walks the chat back one prompt per tap. Sits at the right edge, level
 * with the working status and "Scroll to end", which reserve room for it.
 */
export function PreviousPromptButton(props: {
  readonly colorScheme: "light" | "dark";
  readonly onPress: () => void;
  readonly lift?: SharedValue<number>;
}) {
  const lift = props.lift;
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(lift?.value ?? 0) }],
  }));
  return (
    <Animated.View
      pointerEvents="box-none"
      className="absolute z-20"
      style={[{ top: FLOATING_WORKING_CONTROL_ROW_TOP, right: MESSAGE_BOX_EDGE_INSET }, liftStyle]}
      entering={ENTERING}
      exiting={EXITING}
    >
      {NATIVE_LIQUID_GLASS_SUPPORTED ? (
        <GlassView
          colorScheme={props.colorScheme}
          glassEffectStyle="regular"
          isInteractive
          style={{ width: 44, height: 44, borderRadius: 22, overflow: "hidden" }}
        >
          <ControlPill
            accessibilityLabel="Previous prompt"
            activateOnPressIn
            className="h-11 w-11 bg-transparent"
            icon={{ ios: "chevron.up", android: "keyboard_arrow_up" }}
            onPress={props.onPress}
          />
        </GlassView>
      ) : (
        <ControlPill
          accessibilityLabel="Previous prompt"
          activateOnPressIn
          className="h-11 w-11 border border-border bg-glass-fallback shadow-md shadow-black/10"
          icon={{ ios: "chevron.up", android: "keyboard_arrow_up" }}
          onPress={props.onPress}
        />
      )}
    </Animated.View>
  );
}
