import { requireOptionalNativeModule } from "expo";

/** Android's digital assistant slot (Settings > Apps > Default apps). Null on other platforms. */
export interface AssistantModule {
  /** True once per assistant gesture, including the one that launched the app. */
  takeLaunch(): boolean;
  /** False once the user has left the app since the latest gesture, which withdraws it. */
  isLaunchCurrent(): boolean;
  isDefaultAssistant(): boolean;
  openAssistantSettings(): boolean;
  addListener(event: "onAssist", listener: () => void): { remove(): void };
}

export const assistantModule = requireOptionalNativeModule<AssistantModule>("T3Assistant");
