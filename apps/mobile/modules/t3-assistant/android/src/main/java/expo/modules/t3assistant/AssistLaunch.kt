package expo.modules.t3assistant

import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings

private const val EXTRA_SEEN = "expo.modules.t3assistant.SEEN"

/**
 * Whether an activity intent is an assistant gesture that hasn't been acted on. Android hands the
 * same intent back when it rebuilds the activity or reopens the app from Recents, and neither is
 * the user asking for the assistant again.
 */
internal fun isNewAssistLaunch(action: String?, flags: Int, alreadySeen: Boolean): Boolean =
  action == Intent.ACTION_ASSIST &&
    flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY == 0 &&
    !alreadySeen

internal fun isDefaultAssistant(context: Context): Boolean =
  runCatching {
    if (Build.VERSION.SDK_INT >= 29) {
      context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_ASSISTANT)
        ?: false
    } else {
      Settings.Secure.getString(context.contentResolver, "assistant")
        ?.startsWith("${context.packageName}/") ?: false
    }
  }.getOrDefault(false)

/**
 * The latest assistant gesture: whether JavaScript has taken it yet, and whether the user is still
 * where it put them. A gesture is withdrawn when the activity pauses after showing for it, so its
 * work can't finish later, such as starting the microphone when the user returns to the app.
 */
internal class AssistLaunchState {
  private var pending = false
  private var current = false
  private var shown = false

  // The activity writes on the main thread while JavaScript reads and takes from its own.
  @Synchronized
  fun gesture() {
    pending = true
    current = true
    shown = false
  }

  @Synchronized
  fun resumed() {
    if (current) shown = true
  }

  @Synchronized
  fun paused() {
    if (!current || !shown) return
    current = false
    pending = false
  }

  /** True once per gesture. */
  @Synchronized fun take(): Boolean = pending.also { pending = false }

  @Synchronized fun isCurrent(): Boolean = current
}

/**
 * Process-wide, because the activity can receive a gesture before the React context, and so the
 * module, exists.
 */
internal object AssistLaunches {
  val state = AssistLaunchState()

  @Volatile var onGesture: (() -> Unit)? = null

  fun note(context: Context, intent: Intent?) {
    if (intent == null) return
    // Reading extras can throw on a malformed intent from another app.
    val seen = runCatching { intent.getBooleanExtra(EXTRA_SEEN, false) }.getOrDefault(true)
    if (!isNewAssistLaunch(intent.action, intent.flags, seen)) return
    intent.putExtra(EXTRA_SEEN, true)
    // Any app can send ACTION_ASSIST; only act once the user has made this app the assistant.
    if (!isDefaultAssistant(context)) return
    state.gesture()
    onGesture?.invoke()
  }
}
