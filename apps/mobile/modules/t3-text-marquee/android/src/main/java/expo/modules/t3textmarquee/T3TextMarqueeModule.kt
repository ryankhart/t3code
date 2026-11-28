package expo.modules.t3textmarquee

import androidx.compose.foundation.basicMarquee
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.ui.ModifierFactory
import expo.modules.ui.ModifierRegistry
import kotlinx.coroutines.delay

private const val MARQUEE_ONCE = "t3MarqueeOnce"
private val VELOCITY = 50.dp

/**
 * Adds `t3MarqueeOnce({ run })` to @expo/ui's modifiers: text wider than its box scrolls through
 * once, then the modifier steps aside so the text's own ellipsis returns. A new `run` starts
 * another lap.
 */
class T3TextMarqueeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3TextMarquee")

    OnCreate { ModifierRegistry.register(MARQUEE_ONCE, marqueeOnce) }
    OnDestroy { ModifierRegistry.unregister(MARQUEE_ONCE) }
  }
}

private val marqueeOnce: ModifierFactory = { map, _, _, _ ->
  val run = map["run"]?.asInt() ?: 0
  val velocityPx = with(LocalDensity.current) { VELOCITY.toPx() }
  var lapDone by remember(run) { mutableStateOf(false) }
  var boxWidth by remember(run) { mutableIntStateOf(0) }
  var textWidth by remember(run) { mutableIntStateOf(0) }
  LaunchedEffect(run, boxWidth, textWidth) {
    if (lapDone || boxWidth == 0 || textWidth == 0) return@LaunchedEffect
    if (textWidth > boxWidth) {
      // One lap: the text plus basicMarquee's default gap of a third of the box, plus a few
      // frames so the lap has drawn its last frame.
      delay(((textWidth + boxWidth / 3f) / velocityPx * 1000).toLong() + 100)
    }
    lapDone = true
  }
  if (lapDone) {
    Modifier
  } else {
    Modifier
      .onSizeChanged { boxWidth = it.width }
      .basicMarquee(iterations = 1, initialDelayMillis = 0, velocity = VELOCITY)
      // basicMarquee measures what follows it at unbounded width: the text's full length.
      .layout { measurable, constraints ->
        val placeable = measurable.measure(constraints)
        textWidth = placeable.width
        layout(placeable.width, placeable.height) { placeable.place(0, 0) }
      }
  }
}
