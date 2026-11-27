package expo.modules.t3apkupdater

import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.security.DigestInputStream
import java.security.MessageDigest

private object PendingInstall {
  @Volatile var result: Promise? = null
  @Volatile var confirmIntent: Intent? = null
}

class InstallResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    val promise = PendingInstall.result
    PendingInstall.result = null
    when (status) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        PendingInstall.confirmIntent =
          if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
          } else {
            @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
          }
        promise?.resolve("pending_user_action")
      }
      PackageInstaller.STATUS_SUCCESS -> promise?.resolve("success")
      else -> {
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        promise?.reject("ERR_APK_INSTALL", message ?: "The update didn't install (status $status).", null)
      }
    }
  }
}

private const val PREFS = "t3-apk-updater"
private const val REOPEN_AFTER_UPDATE = "reopenAfterUpdate"

/** Starts the new version after an update the user asked for in Settings. */
class UpdatedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(REOPEN_AFTER_UPDATE, false)) return
    prefs.edit().remove(REOPEN_AFTER_UPDATE).apply()
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    runCatching { context.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
  }
}

class T3ApkUpdaterModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "The app isn't ready." }

  override fun definition() = ModuleDefinition {
    Name("T3ApkUpdater")

    Function("versionCode") {
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      if (Build.VERSION.SDK_INT >= 28) info.longVersionCode.toDouble()
      else @Suppress("DEPRECATION") info.versionCode.toDouble()
    }

    Function("canInstall") {
      Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()
    }

    // Follows the underlying network through a VPN such as Tailscale.
    Function("isMetered") {
      context.getSystemService(ConnectivityManager::class.java)?.isActiveNetworkMetered ?: true
    }

    Function("openInstallPermissionSettings") {
      if (Build.VERSION.SDK_INT < 26) return@Function false
      val intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
        true
      } catch (_: ActivityNotFoundException) {
        false
      }
    }

    // Copies the APK into an install session while the app is still in front, so the
    // later commit is quick even if Android freezes the app soon after it leaves the screen.
    AsyncFunction("stage") { uri: String, sha256: String ->
      val installer = context.packageManager.packageInstaller
      for (old in installer.mySessions) runCatching { installer.abandonSession(old.sessionId) }
      val file = File(Uri.parse(uri).path ?: uri)
      val params =
        PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
          setAppPackageName(context.packageName)
          setSize(file.length())
          if (Build.VERSION.SDK_INT >= 31) {
            setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
          }
        }
      val sessionId = installer.createSession(params)
      try {
        val digest = MessageDigest.getInstance("SHA-256")
        installer.openSession(sessionId).use { session ->
          session.openWrite("base.apk", 0, file.length()).use { out ->
            DigestInputStream(file.inputStream(), digest).use { it.copyTo(out, 1 shl 16) }
            session.fsync(out)
          }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        check(actual.equals(sha256, ignoreCase = true)) {
          "The downloaded update doesn't match its checksum."
        }
      } catch (cause: Throwable) {
        runCatching { installer.abandonSession(sessionId) }
        throw cause
      }
      sessionId
    }

    // On success Android replaces the app and ends this process, so the promise only
    // settles for a failure or when Android still wants a tap.
    AsyncFunction("commit") { sessionId: Int, reopen: Boolean, promise: Promise ->
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(REOPEN_AFTER_UPDATE, reopen)
        .commit()
      val intent = Intent(context, InstallResultReceiver::class.java).setPackage(context.packageName)
      val flags =
        PendingIntent.FLAG_UPDATE_CURRENT or
          (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
      val callback = PendingIntent.getBroadcast(context, sessionId, intent, flags)
      PendingInstall.result = promise
      try {
        context.packageManager.packageInstaller.openSession(sessionId).use {
          it.commit(callback.intentSender)
        }
      } catch (cause: Exception) {
        PendingInstall.result = null
        promise.reject("ERR_APK_INSTALL", cause.message ?: "Could not start the update.", cause)
      }
    }

    Function("confirmPendingInstall") {
      val intent = PendingInstall.confirmIntent ?: return@Function false
      val activity = appContext.currentActivity ?: return@Function false
      PendingInstall.confirmIntent = null
      activity.startActivity(intent)
      true
    }
  }
}
