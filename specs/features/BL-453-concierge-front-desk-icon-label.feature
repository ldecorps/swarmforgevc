Feature: The front-desk standing topic is rebranded Concierge with the bell icon

  # BL-453 (chore, human-requested via Operator/Telegram 2026-07-16): the front-desk/Telegram surface
  # is being renamed Operator -> Concierge. Set the front-desk standing topic's ICON to the bell-hop
  # desk bell (🛎, human-chosen: "The bell is fine", OPERATOR thread 2026-07-16 11:16Z) and its LABEL
  # to "Concierge". Two backlog-root intake items folded into one ticket: the rebrand request
  # (1784200528742) and its glyph addendum (1784200719791). Sibling of BL-449 (epic topic musical-form
  # icons) and BL-424 (awaiting-approval icon).
  #
  # Seams (verified in code 2026-07-16):
  #   - Icon: STANDING_TOPIC_ICON.operator in extension/src/concierge/topicIcon.ts, TODAY '🏛'
  #     (opera-house, BL-418) -> change to the bell '🛎'. The concierge tick's syncTopicIcon already
  #     drives the standing-topic icon from this table (conciergeTick.ts:311), resolving the glyph's
  #     sticker id via resolveIconStickerId/IconStickerLookup; a single-topic single edit (no fan-out
  #     storm). This SUPERSEDES the BL-418 opera-house choice for the front desk; update
  #     docs/branding/icon-system.md to match in the documenter pass.
  #   - Label: OPERATOR_TOPIC_NAME in extension/src/tools/telegramFrontDeskBotCore.ts, TODAY 'Operator'
  #     -> 'Concierge'. That constant is the create-time name (telegram-front-desk-bot.ts:314
  #     createForumTopic). Because the front-desk topic already EXISTS and is bound (ensureOperatorTopic,
  #     idempotent), the LIVE topic must be RENAMED via editForumTopic(name) too, not only the constant
  #     for future creation — reuse the existing topic-title edit seam (topicTitleSync.ts / editForumTopic,
  #     BL-414), rate-limit-safe.
  #   - Do NOT change OPERATOR_SUBJECT_ID ('OPERATOR') — it is the durable binding/ownership key, not the
  #     display label; changing it would re-mint or orphan the topic. Only the display name + icon change.
  #
  # Out of scope: the broader Operator->Concierge rename of message SIGNATURES / bylines (the "still-unfiled
  # Concierge rename" the intake names) — that is a separate follow-up, not this icon+label ticket.
  #
  # Sequencing: touches topicIcon.ts + the front-desk topic title, overlapping active BL-449 (topic icons)
  # and BL-414 (topic-title-age sync) — sequence behind them, not concurrent on the shared files.

  # BL-453 concierge-icon-01
  Scenario: The front-desk standing topic uses the bell icon
    Given the front-desk standing topic
    When its standing-topic icon is synced
    Then its icon is the bell

  # BL-453 concierge-icon-02
  Scenario: The front-desk standing topic is labelled Concierge
    Given the front-desk standing topic
    When its topic title is applied
    Then its title is "Concierge"

  # BL-453 concierge-icon-03
  Scenario: Rebranding reuses the existing bound topic rather than re-creating it
    Given the front-desk standing topic is already bound
    When its title and icon are updated to the Concierge rebrand
    Then the same topic is reused
    And its durable binding id is unchanged
