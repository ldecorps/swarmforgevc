Feature: The pipeline board message is the only pinned message in the Telegram group

  # BL-467 (feature, human-requested via the Operator front desk, relayed 2026-07-16 from a Telegram
  # intake by ldecorps — INTAKE-operator-question-1784236267242, a follow-up to the pinned-messages
  # thread): "at the moment, I only want the pipeline board to be pinned." Desired end state = the
  # live pipeline board message (the monospace kanban grid posted in the dedicated Pipeline Board
  # Telegram topic by BL-452/455/462) is the ONLY pinned message in the group; nothing else stays
  # pinned. The Operator verified 2026-07-16 21:01Z that the bridge has NO pin/unpin call anywhere
  # today, so this is new behavior. Relates to the pipeline-board cluster BL-462/464/465.
  #
  # Human's clarifying answer (specifier, 2026-07-16): ENFORCE CONTINUOUSLY — on every concierge
  # tick, unpin any message that is not the current board and keep the board pinned, including
  # messages a human pins by hand later (until the human asks to disable this). This is the literal
  # reading of "nothing else should be pinned".
  #
  # Mechanism decisions:
  #   - Telegram Bot API pins are CHAT-LEVEL (one pin list per group; pinChatMessage takes no
  #     message_thread_id), which is exactly the "pinned message in the group" the human means — so
  #     the board message (which physically lives in the Pipeline Board topic) is pinned chat-wide.
  #   - The board already DELETES its old message and POSTS a fresh one on each content change
  #     (BL-462), so the pinned message id changes on every repost; the pin must follow to the new
  #     board message. Deleting a pinned message auto-unpins it in Telegram, but the enforcement
  #     below does not rely on that.
  #   - Change-gate to avoid churn/service-message spam (~2880 ticks/day): detect the CURRENT top
  #     pinned message via getChat().pinned_message. Enforce (unpin all, then pin the board) ONLY
  #     when the top pinned message is not the current board; when the board already IS the top pin,
  #     the tick is a complete no-op. Pin silently (disable_notification) so re-pins do not alert the
  #     group. This is NOT a per-topic fan-out (the anti-storm/backfill rule) — it is a single
  #     unpin-all + single pin, so no first-tick storm applies.
  #
  # Scope (grep-confirm live paths at build):
  #   - extension/src/notify/telegramClient.ts: add three thin Bot API wrappers — pinChatMessage
  #     (with disable_notification), unpinAllChatMessages, and a getChat wrapper exposing
  #     pinned_message's message_id. Same thin-wrapper posture as the existing sendTelegramMessage /
  #     deleteMessage / editForumTopic wrappers.
  #   - a new pure/testable module (e.g. extension/src/concierge/pipelineBoardPinSync.ts) mirroring
  #     pipelineBoardSync.ts: a decision function over (currentTopPinnedId, boardMessageId) plus a
  #     sync function that drives injected adapters { getTopPinnedMessageId, unpinAllMessages,
  #     pinMessage }. Best-effort like the board's deleteMessage adapter: a failed pin/unpin never
  #     throws and never aborts the tick.
  #   - extension/src/concierge/conciergeTick.ts: run this pin sync every tick AFTER the board sync
  #     (so it sees the freshly-posted board messageId from PipelineBoardState), gated on the new
  #     adapters being wired (absent adapters = no pin sync, same posture as boardAdapters).
  #   - extension/src/tools/telegram-front-desk-bot.ts: build the live adapters over the three new
  #     telegramClient wrappers, alongside the existing boardAdapters block.
  #
  # This ticket INCLUDES its runtime-wiring (conciergeTick step + live adapters) — the pure module
  # is not shipped dark (engineering "no dark module" / specifier live-DATA-dependency rules).

  Background:
    Given a pipeline board pin sync driven by injected pin adapters

  # BL-467 pipeline-board-only-pin-01
  Scenario Outline: The pin sync enforces the board as the single pin only when it is not already the top pin
    Given the current top pinned message in the group is <currentPin>
    And the current board message id is <boardId>
    When the pin sync runs
    Then the pin sync outcome is <outcome>
    And unpin-all is called: <unpinAll>
    And the board message is pinned: <pinBoard>

    Examples:
      | currentPin | boardId | outcome        | unpinAll | pinBoard |
      | none       | none    | skip-no-board  | no       | no       |
      | none       | 100     | enforce        | yes      | yes      |
      | 100        | 100     | skip-clean     | no       | no       |
      | 55         | 100     | enforce        | yes      | yes      |

  # BL-467 pipeline-board-only-pin-02
  Scenario: A failed pin attempt is best-effort and does not abort the tick
    Given the current board message id is 100
    And a different message is currently pinned in the group
    And the pin adapter reports the pin attempt failed
    When the pin sync runs
    Then the pin sync completes without throwing
    And the pin sync outcome is enforce
