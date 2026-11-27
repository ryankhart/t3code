import { useAtomValue } from "@effect/atom-react";
import { msg, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { TextInput, View } from "react-native";

import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import {
  DEFAULT_DICTATION_STYLE,
  DICTATION_EXTRA_INSTRUCTIONS_MAX,
  resolveDictationStyle,
  type DictationStyle,
} from "./dictationStyle";
import { dictationCleanupConnectionAtom } from "./voiceDestination";
import { useDictationStyle } from "./VoiceInputProvider";

type BooleanKey = {
  [K in keyof DictationStyle]: DictationStyle[K] extends boolean ? K : never;
}[keyof DictationStyle];

const QUICK_FIXES: ReadonlyArray<{
  readonly key: BooleanKey;
  readonly label: string;
  readonly subtitle: string;
}> = [
  {
    key: "joinPauseBreaks",
    label: msg("Join sentences broken by pauses"),
    subtitle: msg("“I raised my? Raised my tone” becomes one sentence"),
  },
  {
    key: "realQuestionsOnly",
    label: msg("Question marks only for questions"),
    subtitle: msg("A raised voice no longer turns a statement into a question"),
  },
  {
    key: "removeFillers",
    label: msg("Remove filler sounds"),
    subtitle: msg("Um, uh, er and hmm"),
  },
];

const AI_EDITS: ReadonlyArray<{
  readonly key: BooleanKey;
  readonly label: string;
  readonly subtitle: string;
}> = [
  {
    key: "fixGrammar",
    label: msg("Fix grammar"),
    subtitle: msg("Keeps your meaning, tone and how sure you sounded"),
  },
  {
    key: "removeRepeats",
    label: msg("Remove stutters and repeats"),
    subtitle: msg("“That could that could be” becomes “that could be”"),
  },
  {
    key: "applyChangesOfMind",
    label: msg("Apply changes of mind"),
    subtitle: msg("Off: “scratch that” and self-corrections stay, so your thinking shows"),
  },
  {
    key: "formatLists",
    label: msg("Format spoken lists"),
    subtitle: msg("Items you list out go on their own lines"),
  },
  {
    key: "paragraphs",
    label: msg("Split into paragraphs"),
    subtitle: msg("A new paragraph where the topic changes"),
  },
  {
    key: "spokenCommands",
    label: msg("Follow spoken commands"),
    subtitle: msg("Say “new line”, “new paragraph”, “period” or “comma”"),
  },
  {
    key: "codeFormatting",
    label: msg("Format code words"),
    subtitle: msg("File names and commands get `backticks`"),
  },
];

/** Settings > Voice: how dictated speech becomes text. */
export function DictationStyleSection() {
  const gt = useGT();
  const m = useMessages();
  const style = useDictationStyle();
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const cleanupConnected = useAtomValue(dictationCleanupConnectionAtom) !== null;
  const [instructions, setInstructions] = useState<string | null>(null);
  const update = (patch: Partial<DictationStyle>) =>
    void savePreferences({
      transform: (current) => ({
        dictationStyle: { ...resolveDictationStyle(current.dictationStyle), ...patch },
      }),
    });
  const changed = (Object.keys(DEFAULT_DICTATION_STYLE) as Array<keyof DictationStyle>).some(
    (key) => style[key] !== DEFAULT_DICTATION_STYLE[key],
  );

  return (
    <>
      <SettingsSection
        title={gt("Dictation: when words appear")}
        footer={gt(
          "As I speak shows the words in the voice bar while you talk, when this phone does the transcribing. Either way, the cleaned-up text goes into your message when you finish.",
        )}
      >
        <ListChoiceRow
          label={gt("As I speak")}
          description={gt("See the words while you talk")}
          selected={style.timing === "live"}
          onPress={() => update({ timing: "live" })}
        />
        <ListChoiceRow
          label={gt("When I finish")}
          description={gt("Turn the whole recording into text at the end")}
          selected={style.timing === "end"}
          separated
          onPress={() => update({ timing: "end" })}
        />
      </SettingsSection>
      <SettingsSection
        title={gt("Dictation: quick fixes")}
        footer={gt("Instant, on this phone, for every dictation, including talk mode.")}
      >
        {QUICK_FIXES.map((option) => (
          <SettingsSwitchRow
            key={option.key}
            label={m(option.label)}
            subtitle={m(option.subtitle)}
            value={style[option.key]}
            onValueChange={(value) => update({ [option.key]: value })}
          />
        ))}
      </SettingsSection>
      <SettingsSection
        title={gt("Dictation: AI cleanup when I finish")}
        footer={
          !style.aiCleanup
            ? gt("Off: the transcript goes in with only the quick fixes.")
            : cleanupConnected
              ? gt(
                  "Your PC's text-generation model rewrites the transcript with the whole recording as context. It takes a few seconds; tap the checkmark to skip it. Talk mode skips it so replies start sooner.",
                )
              : gt(
                  "Connect to your PC to use this. Until then the quick fixes still apply. Talk mode skips it so replies start sooner.",
                )
        }
      >
        <SettingsSwitchRow
          label={gt("Clean up with AI")}
          subtitle={gt("Fixes punctuation using everything you said")}
          value={style.aiCleanup}
          onValueChange={(value) => update({ aiCleanup: value })}
        />
        {style.aiCleanup
          ? AI_EDITS.map((option) => (
              <SettingsSwitchRow
                key={option.key}
                label={m(option.label)}
                subtitle={m(option.subtitle)}
                value={style[option.key]}
                onValueChange={(value) => update({ [option.key]: value })}
              />
            ))
          : null}
      </SettingsSection>
      {style.aiCleanup ? (
        <>
          <SettingsSection title={gt("Dictation: wording")}>
            <ListChoiceRow
              label={gt("Keep my words")}
              description={gt("Only the fixes above change anything")}
              selected={style.wording === "mine"}
              onPress={() => update({ wording: "mine" })}
            />
            <ListChoiceRow
              label={gt("Tighten it up")}
              description={gt("Fewer words, same ideas and requests")}
              selected={style.wording === "tighter"}
              separated
              onPress={() => update({ wording: "tighter" })}
            />
          </SettingsSection>
          <SettingsSection
            title={gt("Dictation: extra instructions")}
            footer={gt("Anything else the cleanup should do, such as how to spell names you use.")}
          >
            <View className="px-4 py-3">
              <TextInput
                accessibilityLabel={gt("Extra cleanup instructions")}
                placeholder={gt("Example: write T3 Code, not T3 code")}
                multiline
                maxLength={DICTATION_EXTRA_INSTRUCTIONS_MAX}
                value={instructions ?? style.extraInstructions}
                onChangeText={setInstructions}
                onBlur={() => {
                  if (instructions !== null && instructions !== style.extraInstructions) {
                    update({ extraInstructions: instructions });
                  }
                  setInstructions(null);
                }}
                className="min-h-20 rounded-lg bg-background px-3 py-2 text-foreground"
                textAlignVertical="top"
              />
            </View>
          </SettingsSection>
        </>
      ) : null}
      {changed ? (
        <SettingsSection>
          <ListActionRow
            icon="arrow.clockwise"
            label={gt("Reset dictation style")}
            onPress={() => {
              setInstructions(null);
              void savePreferences({ dictationStyle: { ...DEFAULT_DICTATION_STYLE } });
            }}
          />
        </SettingsSection>
      ) : null}
    </>
  );
}
