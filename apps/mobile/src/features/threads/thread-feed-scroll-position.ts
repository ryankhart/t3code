export interface ThreadWorkGroupScrollPosition {
  readonly rowId: string;
  readonly offsetWithinRow: number;
  readonly scrollOffset: number;
}

export function resolveThreadWorkGroupInitialScroll(
  rows: ReadonlyArray<{ readonly id: string }>,
  position: ThreadWorkGroupScrollPosition | undefined,
) {
  const index = position ? rows.findIndex((row) => row.id === position.rowId) : -1;
  return index >= 0 && position ? { index, viewOffset: -position.offsetWithinRow } : undefined;
}

export function resolveThreadFeedSubmissionAnchor<AnchorId>(input: {
  readonly currentAnchorMessageId: AnchorId | null;
  readonly submittedMessageId: AnchorId;
  readonly hasStartedTurn: boolean;
  readonly hasUserMessage: boolean;
  readonly queuedMessageCount: number;
  readonly deliveryDeferred: boolean;
  /** Custom build ("Start at my last prompt"): every prompt that starts now goes to the top. */
  readonly anchorEveryPrompt?: boolean;
}): AnchorId | null {
  if (input.anchorEveryPrompt) {
    return input.deliveryDeferred || input.queuedMessageCount > 0
      ? input.currentAnchorMessageId
      : input.submittedMessageId;
  }

  // Keeping the first message's anchor holds a short thread in place; a follow-up never anchors.
  if (input.currentAnchorMessageId !== null) {
    return input.currentAnchorMessageId;
  }

  if (input.deliveryDeferred || input.hasStartedTurn || input.hasUserMessage) {
    return null;
  }

  return input.queuedMessageCount > 0 ? null : input.submittedMessageId;
}
