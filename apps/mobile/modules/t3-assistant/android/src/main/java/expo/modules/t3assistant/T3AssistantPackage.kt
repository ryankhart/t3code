package expo.modules.t3assistant

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/** Watches the activity's intents and lifecycle, which run whether or not React has started. */
class T3AssistantPackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context
  ): List<ReactActivityLifecycleListener> =
    listOf(
      object : ReactActivityLifecycleListener {
        override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
          AssistLaunches.note(activity, activity.intent)
        }

        override fun onNewIntent(intent: Intent?): Boolean {
          AssistLaunches.note(activityContext, intent)
          return false
        }

        override fun onResume(activity: Activity) = AssistLaunches.state.resumed()

        override fun onPause(activity: Activity) = AssistLaunches.state.paused()
      }
    )
}
