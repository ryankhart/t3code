import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

/**
 * Custom build: "Next prompt" and "Previous prompt" walk the chat one prompt per press.
 * They sit at the message column's right edge, level with "Scroll to end", each in a
 * fixed slot so one hiding never moves the other.
 */
export function PromptJumpButtons(props: {
  readonly bottom: number;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}) {
  return (
    <div
      className="chat-scroll-to-bottom pointer-events-none absolute z-30 py-1.5"
      style={{ bottom: props.bottom }}
    >
      <div className="mx-auto flex w-full max-w-(--chat-content-max-width) justify-end gap-1.5 px-3 sm:px-12">
        <PromptJumpButton
          label="Next prompt"
          visible={props.canGoForward}
          data-next-prompt="true"
          onPress={props.onNext}
        >
          <ChevronDownIcon className="size-3.5" />
        </PromptJumpButton>
        <PromptJumpButton
          label="Previous prompt"
          visible={props.canGoBack}
          data-previous-prompt="true"
          onPress={props.onPrevious}
        >
          <ChevronUpIcon className="size-3.5" />
        </PromptJumpButton>
      </div>
    </div>
  );
}

function PromptJumpButton(props: {
  readonly label: string;
  readonly visible: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
  readonly "data-next-prompt"?: "true";
  readonly "data-previous-prompt"?: "true";
}) {
  return (
    <Button
      aria-label={props.label}
      title={props.label}
      data-next-prompt={props["data-next-prompt"]}
      data-previous-prompt={props["data-previous-prompt"]}
      onPointerDown={(event) => event.preventDefault()}
      onClick={props.onPress}
      // `invisible` keeps the slot, and hides the button from clicks, Tab and screen readers.
      className={cn("pointer-events-auto", !props.visible && "invisible")}
      size="icon-xs"
      variant="glass"
    >
      {props.children}
    </Button>
  );
}
