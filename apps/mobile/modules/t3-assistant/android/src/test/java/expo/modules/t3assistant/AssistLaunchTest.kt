package expo.modules.t3assistant

import android.content.Intent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AssistLaunchTest {
  @Test
  fun acceptsAFreshAssistantGesture() {
    assertTrue(isNewAssistLaunch(Intent.ACTION_ASSIST, Intent.FLAG_ACTIVITY_NEW_TASK, false))
  }

  @Test
  fun ignoresOtherLaunches() {
    assertFalse(isNewAssistLaunch(Intent.ACTION_MAIN, 0, false))
    assertFalse(isNewAssistLaunch(null, 0, false))
  }

  @Test
  fun ignoresAGestureAlreadyActedOn() {
    assertFalse(isNewAssistLaunch(Intent.ACTION_ASSIST, 0, true))
  }

  @Test
  fun ignoresTheAppReopenedFromRecents() {
    val flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY
    assertFalse(isNewAssistLaunch(Intent.ACTION_ASSIST, flags, false))
  }

  @Test
  fun aGestureIsTakenOnceAndStaysCurrentWhileTheAppIsInFront() {
    val state = AssistLaunchState()
    assertFalse(state.take())
    assertFalse(state.isCurrent())

    // An open app pauses before it gets the gesture, and resumes after.
    state.paused()
    state.gesture()
    state.resumed()
    assertTrue(state.isCurrent())
    assertTrue(state.take())
    assertFalse(state.take())
    assertTrue(state.isCurrent())
  }

  @Test
  fun leavingTheAppWithdrawsTheGesture() {
    val state = AssistLaunchState()
    state.gesture()
    state.resumed()
    state.paused()
    assertFalse(state.isCurrent())
    assertFalse(state.take())

    // Coming back is not a new gesture.
    state.resumed()
    assertFalse(state.isCurrent())
  }
}
