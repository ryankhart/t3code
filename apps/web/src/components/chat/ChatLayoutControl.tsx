import { MAX_CHAT_CUSTOM_WIDTH_REM, MIN_CHAT_CUSTOM_WIDTH_REM } from "@t3tools/contracts/settings";
import { useGT } from "gt-react";
import { AlignHorizontalJustifyCenterIcon, AlignHorizontalJustifyStartIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Where the slider rests for each preset, in rem. index.css owns the widths themselves. */
const PRESET_WIDTH_REM = { comfortable: 46, wide: 72, full: MAX_CHAT_CUSTOM_WIDTH_REM };

/** Sets a custom chat width; while a preset is chosen it rests at that preset's width. */
export function ChatWidthSlider(props: { readonly id: string }) {
  const gt = useGT();
  const chatWidth = useClientSettings((settings) => settings.chatWidth);
  const customWidthRem = useClientSettings((settings) => settings.chatCustomWidthRem);
  // The interface font size is the root font size, so it turns rem into pixels.
  const pixelsPerRem = useClientSettings((settings) => settings.fontSizeInterface);
  const widthRem = chatWidth === "custom" ? customWidthRem : PRESET_WIDTH_REM[chatWidth];
  const ratio =
    (widthRem - MIN_CHAT_CUSTOM_WIDTH_REM) /
    (MAX_CHAT_CUSTOM_WIDTH_REM - MIN_CHAT_CUSTOM_WIDTH_REM);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <input
        aria-label={gt("Custom chat width")}
        className="settings-slider min-w-0 flex-1"
        id={props.id}
        max={MAX_CHAT_CUSTOM_WIDTH_REM}
        min={MIN_CHAT_CUSTOM_WIDTH_REM}
        onChange={(event) => {
          const chatCustomWidthRem = Number(event.currentTarget.value);
          if (
            Number.isInteger(chatCustomWidthRem) &&
            chatCustomWidthRem >= MIN_CHAT_CUSTOM_WIDTH_REM &&
            chatCustomWidthRem <= MAX_CHAT_CUSTOM_WIDTH_REM
          ) {
            void updateClientSettings({ chatWidth: "custom", chatCustomWidthRem });
          }
        }}
        step={1}
        style={
          {
            "--settings-slider-progress": `${ratio * 100}%`,
            "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
          } as CSSProperties
        }
        type="range"
        value={widthRem}
      />
      <output
        className="min-w-16 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
        htmlFor={props.id}
      >
        {chatWidth === "full"
          ? gt("Full", { $context: "chat width" })
          : gt("{pixels} px", { pixels: Math.round(widthRem * pixelsPerRem) })}
      </output>
    </div>
  );
}

/**
 * The thread header's layout button: where the chat column sits in a pane wider than it, and
 * how wide it may grow. Both are the app-wide Appearance settings, changed where their effect shows.
 */
export function ChatLayoutControl() {
  const gt = useGT();
  const chatAlignment = useClientSettings((settings) => settings.chatAlignment);
  const chatWidth = useClientSettings((settings) => settings.chatWidth);
  const Icon =
    chatAlignment === "start" ? AlignHorizontalJustifyStartIcon : AlignHorizontalJustifyCenterIcon;
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={gt("Chat layout")} />}
            />
          }
        >
          <Icon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{gt("Chat layout")}</TooltipPopup>
      </Tooltip>
      <PopoverPopup side="bottom" align="end" width="md" data-chat-layout-popover>
        <div className="flex flex-col gap-3">
          <PopoverTitle>{gt("Chat layout")}</PopoverTitle>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {gt("Alignment", { $context: "where the chat column sits in its pane" })}
            </span>
            <ToggleGroup
              aria-label={gt("Chat alignment")}
              variant="segmented"
              value={[chatAlignment]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "start" || next === "center") {
                  void updateClientSettings({ chatAlignment: next });
                }
              }}
            >
              <Toggle value="start">{gt("Left", { $context: "chat alignment" })}</Toggle>
              <Toggle value="center">{gt("Center", { $context: "chat alignment" })}</Toggle>
            </ToggleGroup>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {gt("Width", { $context: "how wide the chat column can grow" })}
            </span>
            <ToggleGroup
              aria-label={gt("Chat width")}
              variant="segmented"
              value={chatWidth === "custom" ? [] : [chatWidth]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "comfortable" || next === "wide" || next === "full") {
                  void updateClientSettings({ chatWidth: next });
                }
              }}
            >
              <Toggle value="comfortable">{gt("Comfortable")}</Toggle>
              <Toggle value="wide">{gt("Wide")}</Toggle>
              <Toggle value="full">{gt("Full", { $context: "chat width" })}</Toggle>
            </ToggleGroup>
          </div>
          <ChatWidthSlider id="chat-layout-custom-width" />
        </div>
      </PopoverPopup>
    </Popover>
  );
}
