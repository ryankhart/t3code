import { useAtomValue } from "@effect/atom-react";
import Constants from "expo-constants";

import { ListActionRow } from "../../components/ui/ListActionRow";
import * as Dialog from "../../components/ui/Dialog";
import { makePermissionStatusAtom } from "../../lib/permissionStatusAtom";
import { getProductName } from "../../lib/branding";
import { SettingsSection } from "../settings/components/SettingsSection";
import { assistantModule } from "./assistantModule";

// Chosen in Android's settings, so it is read again each time the app comes back.
const defaultAssistantAtom = makePermissionStatusAtom<boolean | null>({
  label: "mobile:assistant:is-default",
  initial: null,
  read: async () => assistantModule?.isDefaultAssistant() ?? false,
});

/** Android only: shows whether this app is the phone's digital assistant, and where to change it. */
export function AssistantSection() {
  if (!assistantModule) return null;
  return <AndroidAssistantSection assistant={assistantModule} />;
}

function AndroidAssistantSection(props: {
  readonly assistant: NonNullable<typeof assistantModule>;
}) {
  const isDefault = useAtomValue(defaultAssistantAtom);
  // The installed app's own name ("T3 Code Fork"), because that is what Android's list shows.
  const appName = Constants.expoConfig?.name ?? getProductName();
  return (
    <SettingsSection
      title="Digital assistant"
      footer={`As your phone's digital assistant, ${appName} opens a new thread without a project and starts dictating when you use the assistant gesture, such as holding the side button.`}
    >
      <ListActionRow
        icon="mic"
        label={isDefault ? `${appName} is your digital assistant` : "Set as digital assistant"}
        description={
          isDefault
            ? "Change it in Android settings"
            : `Choose ${appName} under Digital assistant app in Android settings`
        }
        onPress={() => {
          if (props.assistant.openAssistantSettings()) return;
          Dialog.alert(
            "Could not open Android settings",
            "Open Settings > Apps > Default apps > Digital assistant app.",
          );
        }}
      />
    </SettingsSection>
  );
}
