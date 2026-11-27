import type { AppStateStatus } from "react-native";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  checkApkUpdateNow,
  getApkUpdateStatus,
  installApkUpdateChecks,
  installApkUpdateNow,
  pickApkUpdate,
  type ApkUpdate,
  type ApkUpdateEnvironment,
} from "./apk-updates";

vi.mock("expo-updates", () => ({ isEnabled: false }));
vi.mock("expo", () => ({ requireOptionalNativeModule: vi.fn(() => null) }));
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Platform: { OS: "android" },
}));

const DIGEST = "a".repeat(64);

function apkAsset(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    size: 1000,
    digest: `sha256:${DIGEST}`,
    browser_download_url: `https://github.com/ryankhart/t3code/releases/download/v0.1.5907/${name}`,
    ...overrides,
  };
}

function release(assets: unknown[], overrides: Record<string, unknown> = {}) {
  return { tag_name: "v0.1.5907", draft: false, prerelease: false, assets, ...overrides };
}

describe("pickApkUpdate", () => {
  const installed = 105906;

  it("picks the release's APK when it is newer than the installed build", () => {
    const latest = release([
      apkAsset("T3-Code-Fork-0.1.5907-x64.exe"),
      apkAsset("T3-Code-Fork-0.1.5907.apk"),
    ]);
    expect(pickApkUpdate(latest, installed)).toEqual({
      version: "0.1.5907",
      versionCode: 105907,
      fileName: "T3-Code-Fork-0.1.5907.apk",
      url: "https://github.com/ryankhart/t3code/releases/download/v0.1.5907/T3-Code-Fork-0.1.5907.apk",
      size: 1000,
      sha256: DIGEST,
    });
  });

  it.each([
    ["the same build", release([apkAsset("T3-Code-Fork-0.1.5906.apk")])],
    ["an older build", release([apkAsset("T3-Code-Fork-0.1.5800.apk")])],
    ["no APK yet", release([apkAsset("T3-Code-Fork-0.1.5907-x64.exe")])],
    ["no checksum", release([apkAsset("T3-Code-Fork-0.1.5907.apk", { digest: null })])],
    [
      "a download outside GitHub",
      release([
        apkAsset("T3-Code-Fork-0.1.5907.apk", {
          browser_download_url: "https://example.com/x.apk",
        }),
      ]),
    ],
    ["a draft", release([apkAsset("T3-Code-Fork-0.1.5907.apk")], { draft: true })],
    ["a version outside the versionCode scheme", release([apkAsset("T3-Code-Fork-0.100.1.apk")])],
    ["an error body", { message: "API rate limit exceeded" }],
  ])("ignores %s", (_label, latest) => {
    expect(pickApkUpdate(latest, installed)).toBeNull();
  });
});

function makeEnvironment(overrides: Partial<ApkUpdateEnvironment["updater"]> = {}) {
  let onAppState: (state: AppStateStatus) => void = () => undefined;
  let now = 0;
  const dispose = vi.fn();
  const environment = {
    updater: {
      versionCode: vi.fn(() => 105906),
      canInstall: vi.fn(() => true),
      isMetered: vi.fn(() => false),
      openInstallPermissionSettings: vi.fn(() => true),
      stage: vi.fn(async () => 42),
      commit: vi.fn(async (): Promise<"pending_user_action" | "success"> => "success"),
      confirmPendingInstall: vi.fn(() => true),
      ...overrides,
    },
    fetchLatestRelease: vi.fn(async () => release([apkAsset("T3-Code-Fork-0.1.5907.apk")])),
    download: vi.fn(async (update: ApkUpdate) => ({
      uri: `file:///cache/${update.fileName}`,
      size: update.size,
      dispose,
    })),
    askForInstallPermission: vi.fn(),
    flushPendingWrites: vi.fn(async () => {}),
    isSafeToInstall: vi.fn(async () => true),
    subscribeAppState: vi.fn((listener: (state: AppStateStatus) => void) => {
      onAppState = listener;
      return () => undefined;
    }),
    now: () => now,
    warn: vi.fn(),
  } satisfies ApkUpdateEnvironment;
  return {
    environment,
    dispose,
    emit: (state: AppStateStatus) => onAppState(state),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("installApkUpdateChecks", () => {
  it("stages a newer APK at launch and installs it only once the app leaves the screen", async () => {
    const { environment, dispose, emit } = makeEnvironment();
    installApkUpdateChecks(environment);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalled());
    expect(environment.updater.stage).toHaveBeenCalledWith(
      "file:///cache/T3-Code-Fork-0.1.5907.apk",
      DIGEST,
    );
    expect(environment.updater.commit).not.toHaveBeenCalled();

    emit("background");
    await vi.waitFor(() => expect(environment.updater.commit).toHaveBeenCalledWith(42, false));
    const flushed = vi.mocked(environment.flushPendingWrites).mock.invocationCallOrder[0]!;
    const committed = vi.mocked(environment.updater.commit).mock.invocationCallOrder[0]!;
    expect(flushed).toBeLessThan(committed);
  });

  it("waits for a later background when leaving is only a handoff such as a file picker", async () => {
    const { environment, dispose, emit } = makeEnvironment();
    environment.isSafeToInstall.mockResolvedValueOnce(false);
    installApkUpdateChecks(environment);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalled());

    emit("background");
    await vi.waitFor(() => expect(environment.isSafeToInstall).toHaveBeenCalledTimes(1));
    expect(environment.updater.commit).not.toHaveBeenCalled();
    emit("background");
    await vi.waitFor(() => expect(environment.updater.commit).toHaveBeenCalledTimes(1));
  });

  it("downloads nothing on a metered network", async () => {
    const { environment } = makeEnvironment({ isMetered: vi.fn(() => true) });
    installApkUpdateChecks(environment);
    await vi.waitFor(() => expect(environment.updater.isMetered).toHaveBeenCalled());
    expect(environment.fetchLatestRelease).not.toHaveBeenCalled();
    expect(environment.download).not.toHaveBeenCalled();
  });

  it("asks once for the install permission and never commits without it", async () => {
    const { environment, dispose, emit, advance } = makeEnvironment({
      canInstall: vi.fn(() => false),
    });
    installApkUpdateChecks(environment);
    await vi.waitFor(() => expect(environment.askForInstallPermission).toHaveBeenCalledTimes(1));
    expect(dispose).toHaveBeenCalledTimes(1);

    emit("background");
    advance(60 * 60 * 1000);
    emit("active");
    await vi.waitFor(() => expect(environment.fetchLatestRelease).toHaveBeenCalledTimes(2));
    expect(environment.askForInstallPermission).toHaveBeenCalledTimes(1);
    expect(environment.download).toHaveBeenCalledTimes(1);
    expect(environment.updater.commit).not.toHaveBeenCalled();
  });

  it("shows Android's own install prompt on return when Android still wants a tap", async () => {
    const { environment, dispose, emit } = makeEnvironment({
      commit: vi.fn(async (): Promise<"pending_user_action" | "success"> => "pending_user_action"),
    });
    installApkUpdateChecks(environment);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalled());

    emit("background");
    await vi.waitFor(() => expect(environment.updater.commit).toHaveBeenCalled());
    emit("active");
    expect(environment.updater.confirmPendingInstall).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed install of the same version in this launch", async () => {
    const { environment, dispose, emit, advance } = makeEnvironment({
      commit: vi.fn(async (): Promise<"pending_user_action" | "success"> => {
        throw new Error("INSTALL_FAILED_VERIFICATION_FAILURE");
      }),
    });
    installApkUpdateChecks(environment);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalled());

    emit("background");
    await vi.waitFor(() => expect(environment.warn).toHaveBeenCalled());
    advance(60 * 60 * 1000);
    emit("active");
    await vi.waitFor(() => expect(environment.fetchLatestRelease).toHaveBeenCalledTimes(2));
    expect(environment.download).toHaveBeenCalledTimes(1);
  });
});

describe("the Settings update button", () => {
  it("checks on any network, then downloads, installs and asks to reopen on the second tap", async () => {
    const { environment } = makeEnvironment({ isMetered: vi.fn(() => true) });
    const dispose = installApkUpdateChecks(environment);
    await checkApkUpdateNow();
    expect(getApkUpdateStatus()).toMatchObject({
      kind: "available",
      update: { version: "0.1.5907" },
    });
    expect(environment.download).not.toHaveBeenCalled();

    void installApkUpdateNow();
    await vi.waitFor(() => expect(environment.updater.commit).toHaveBeenCalledWith(42, true));
    expect(getApkUpdateStatus()).toMatchObject({ kind: "installing" });
    const flushed = vi.mocked(environment.flushPendingWrites).mock.invocationCallOrder[0]!;
    const committed = vi.mocked(environment.updater.commit).mock.invocationCallOrder[0]!;
    expect(flushed).toBeLessThan(committed);
    dispose();
  });

  it("says so when the installed build is the newest", async () => {
    const { environment } = makeEnvironment({ isMetered: vi.fn(() => true) });
    environment.fetchLatestRelease.mockResolvedValue(
      release([apkAsset("T3-Code-Fork-0.1.5906.apk")]),
    );
    const dispose = installApkUpdateChecks(environment);
    await checkApkUpdateNow();
    expect(getApkUpdateStatus()).toEqual({ kind: "current" });
    dispose();
  });

  it("sends the user to the install permission once and finishes when they come back", async () => {
    let allowed = false;
    const { environment, emit } = makeEnvironment({
      isMetered: vi.fn(() => true),
      canInstall: vi.fn(() => allowed),
    });
    const dispose = installApkUpdateChecks(environment);
    await checkApkUpdateNow();
    await installApkUpdateNow();
    expect(getApkUpdateStatus()).toMatchObject({ kind: "permission" });
    expect(environment.updater.openInstallPermissionSettings).toHaveBeenCalledTimes(1);
    expect(environment.updater.commit).not.toHaveBeenCalled();

    emit("background");
    allowed = true;
    emit("active");
    await vi.waitFor(() => expect(environment.updater.commit).toHaveBeenCalledWith(42, true));
    expect(environment.download).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("shows why it failed so the next tap can retry", async () => {
    const { environment } = makeEnvironment({ isMetered: vi.fn(() => true) });
    environment.fetchLatestRelease.mockRejectedValueOnce(new Error("GitHub answered 403."));
    const dispose = installApkUpdateChecks(environment);
    await checkApkUpdateNow();
    expect(getApkUpdateStatus()).toEqual({ kind: "failed", message: "GitHub answered 403." });
    await checkApkUpdateNow();
    expect(getApkUpdateStatus()).toMatchObject({ kind: "available" });
    dispose();
  });
});
