Feature: The pipeline board posts the new message before deleting the old one, so there is always at least one board to look at

  # BL-468 (feature, human-requested directly 2026-07-16): "when updating the pipeline board, can you
  # first add the new one, then remove the old one, so there is at least always 1 to look at."
  #
  # Today (BL-462) the board reposts on a content change by DELETING the old message FIRST and THEN
  # posting a fresh one (extension/src/concierge/pipelineBoardSync.ts, postBoardMessage). That opens a
  # window with ZERO board messages in the topic, and if the fresh post then fails the old is already
  # gone AND state.messageId points at a now-deleted message. The human wants the order reversed:
  # POST the new message first, then delete the old (best-effort) — and if the post fails, KEEP the old
  # so there is always at least one board message visible.
  #
  # Scope (grep-confirm live path at build; verified 2026-07-16):
  #   - extension/src/concierge/pipelineBoardSync.ts, postBoardMessage: reorder to post-new THEN
  #     delete-old. On a successful post, delete the prior message best-effort AFTER the new one exists
  #     (unchanged best-effort posture — a failed/already-gone delete never blocks). On a FAILED post,
  #     do NOT delete the prior message; return failed-post with the prior messageId still in state, so
  #     the existing board stays visible and tracked.
  #   - No renderer, change-gate, or adapter-interface change: the deleteMessage/postMessage adapters
  #     and the content-signature edge-trigger are unchanged; only the call ORDER inside postBoardMessage
  #     and the failed-post branch change.
  #
  # Interaction: with post-then-delete, two board messages briefly coexist. That is fine with BL-467's
  # pin sync (it pins the current/new board and continuously unpins the old) and with BL-465's render —
  # all touch the board files, so serialize; this ticket changes only the repost ORDER.
  #
  # INHERITED and unchanged (BL-462): an unchanged tick is a complete no-op (no post, no delete); the
  # board stays the LATEST message in its topic (the new post lands at the bottom, then the old is
  # removed); READ-ONLY / side-effect-free.

  Background:
    Given a pipeline board sync driven by injected post and delete adapters

  # BL-468 board-always-visible-01
  Scenario: On a content change the new message is posted before the old one is deleted
    Given a previously posted board message exists
    And the board content has changed
    When the board sync runs
    Then the new board message is posted before the old board message is deleted

  # BL-468 board-always-visible-02
  Scenario: A failed post leaves the old message in place
    Given a previously posted board message exists
    And the board content has changed
    And posting the new board message fails
    When the board sync runs
    Then the old board message is not deleted
    And the board sync outcome is failed-post

  # BL-468 board-always-visible-03
  Scenario: The first board post has no prior message to delete
    Given no board message has been posted yet
    And the board content has changed
    When the board sync runs
    Then the new board message is posted
    And no delete is attempted
