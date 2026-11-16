import { ChevronUpIcon } from "lucide-react";

import { Button } from "../ui/button";

/**
 * Custom build: walks the chat back one prompt per press. Sits at the message column's
 * right edge, level with "Scroll to end", so neither moves the other.
 */
export function PreviousPromptButton(props: {
  readonly bottom: number;
  readonly onPress: () => void;
}) {
  return (
    <div
      className="chat-scroll-to-bottom pointer-events-none absolute z-30 py-1.5"
      style={{ bottom: props.bottom }}
    >
      <div className="mx-auto flex w-full max-w-(--chat-content-max-width) justify-end px-3 sm:px-12">
        <Button
          aria-label="Previous prompt"
          title="Previous prompt"
          data-previous-prompt="true"
          onPointerDown={(event) => event.preventDefault()}
          onClick={props.onPress}
          className="pointer-events-auto"
          size="icon-xs"
          variant="glass"
        >
          <ChevronUpIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
