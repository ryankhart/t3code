package expo.modules.t3assistant

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val ASSIST_EVENT = "onAssist"

/** Tells the app when Android opened it as the phone's digital assistant (ACTION_ASSIST). */
class T3AssistantModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "The app isn't ready." }

  override fun definition() = ModuleDefinition {
    Name("T3Assistant")

    Events(ASSIST_EVENT)

    OnCreate { AssistLaunches.onGesture = { sendEvent(ASSIST_EVENT) } }

    OnDestroy { AssistLaunches.onGesture = null }

    Function("takeLaunch") { AssistLaunches.state.take() }

    Function("isLaunchCurrent") { AssistLaunches.state.isCurrent() }

    Function("isDefaultAssistant") { isDefaultAssistant(context) }

    Function("openAssistantSettings") {
      val activity = appContext.currentActivity ?: return@Function false
      for (action in
        listOf(Settings.ACTION_VOICE_INPUT_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) {
        try {
          activity.startActivity(Intent(action))
          return@Function true
        } catch (_: ActivityNotFoundException) {
          continue
        }
      }
      false
    }
  }
}
