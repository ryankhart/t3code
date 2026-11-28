import { createModifier } from "@expo/ui/jetpack-compose/modifiers";
import { requireOptionalNativeModule } from "expo";

// Loading the module registers its `t3MarqueeOnce` modifier with @expo/ui.
requireOptionalNativeModule("T3TextMarquee");

/** Cut-off text scrolls through once per new `run`, then shows its ellipsis again. */
export function marqueeOnce(run: number) {
  return [createModifier("t3MarqueeOnce", { run })];
}
