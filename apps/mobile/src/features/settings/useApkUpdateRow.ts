import * as Application from "expo-application";
import { useSyncExternalStore } from "react";

import {
  type ApkUpdateStatus,
  checkApkUpdateNow,
  getApkUpdateStatus,
  installApkUpdateNow,
  isApkUpdateButtonAvailable,
  subscribeApkUpdateStatus,
} from "../updates/apk-updates";

interface ApkUpdateRow {
  readonly id: string;
  readonly icon: "arrow.down.circle";
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

/** The fork's "Check for updates" row: one tap checks, a second downloads, installs and reopens. */
export function useApkUpdateRow(): ApkUpdateRow | null {
  const status = useSyncExternalStore(
    subscribeApkUpdateStatus,
    getApkUpdateStatus,
    getApkUpdateStatus,
  );
  if (!isApkUpdateButtonAvailable()) return null;
  return {
    id: "apk-update",
    icon: "arrow.down.circle",
    ...describeApkUpdateRow(status, Application.nativeApplicationVersion ?? "unknown"),
  };
}

export function describeApkUpdateRow(
  status: ApkUpdateStatus,
  installed: string,
): Omit<ApkUpdateRow, "id" | "icon"> {
  const check = () => void checkApkUpdateNow();
  const install = () => void installApkUpdateNow();
  switch (status.kind) {
    case "idle":
      return row("Check for updates", `Installed: ${installed}`, check);
    case "checking":
      return row("Checking for updates…", `Installed: ${installed}`);
    case "current":
      return row("Up to date", `${installed} is the newest version. Tap to check again.`, check);
    case "available":
      return row(
        `Update to ${status.update.version}`,
        `${megabytes(status.update.size)} MB. Tap to download and install; the app reopens by itself.`,
        install,
      );
    case "downloading":
      return row(`Downloading ${status.update.version}…`, "Keep the app open until it reopens.");
    case "permission":
      return row(
        "Allow T3 Code Fork to install updates",
        'Turn on "Allow from this source", then come back. The update continues by itself.',
        install,
      );
    case "installing":
      return row(`Installing ${status.update.version}…`, "The app closes and reopens.");
    case "failed":
      return row("Check for updates", `Last try failed: ${status.message}`, check);
  }
}

function row(label: string, value: string, onPress?: () => void) {
  return { label, value, disabled: !onPress, onPress: onPress ?? (() => undefined) };
}

function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}
