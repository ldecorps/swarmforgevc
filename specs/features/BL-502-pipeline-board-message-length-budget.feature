Feature: the pipeline board message stays within Telegram's send limit at any backlog size

  # Live outage 2026-07-17 (RCA: backlog/evidence/pipeline-board-message-too-long-20260717.md,
  # follow-on to pipeline-board-frozen-live-outage-20260717.md). BL-497 fixed the SILENCE (the
  # swallowed post error) and, in doing so, logged the real Telegram rejection for the first time:
  #   "Telegram API responded with status 400: Bad Request: text is too long"
  # The board's grid/parked/recently-closed TEXT is ~1500 chars (fine), but BL-465's tappable
  # GitHub link list (renderPipelineBoardLinks: one `<a href=".../blob/main/backlog/....yaml">`
  # line per grid + parked + recently-closed + root-intake entry, ~150-190 chars each) has NO
  # length budget and NO cap. At only 16 linkable entries it renders ~3006 chars, so the composed
  # message (wrapPipelineBoardHtml: `<pre>`grid`</pre>` + the link block) is ~4522 chars — over
  # Telegram's 4096 sendMessage limit. This is STRUCTURAL, not the morning's transient backlog
  # peak: it recurs for any backlog of comparable-or-larger size. BL-497 (correctly) treats the
  # resulting error as unknown/transient and retains the topic, so it bounded-alerts once but can
  # never recover — retrying the SAME oversized payload fails forever until the payload shrinks.
  #
  # This feature pins the observable contract: (1) the composed board message is always within the
  # send limit, so the board POSTS at any backlog size rather than freezing; (2) the elastic part
  # is the tappable link list — it is budgeted to the space remaining after the grid/parked body
  # (which is always kept in full), and links that do not fit are dropped with a VISIBLE overflow
  # indicator naming how many were omitted (never a silent cap — this codebase's no-silent-cap
  # posture, mirroring PIPELINE_BOARD_RECENTLY_CLOSED_MAX's own bounded list); (3) as defence in
  # depth, a "text is too long" post failure is classified on its OWN class (distinct from
  # topic-gone / transient / unknown) so any future oversize payload is labelled correctly by
  # BL-497's alert instead of lumped under "unknown", and — the topic being fine, only the payload
  # too big — it RETAINS the topic (never recreates it). The render/change-gate contract
  # (BL-462/464/465/468/473) and BL-497's failure-recovery contract are otherwise unchanged; the
  # exact budget margin, the trim ordering, and whether per-link text is also shortened are the
  # architect's call — the scenarios below hold either way.

  Background:
    Given a repo base url is configured so the board renders tappable ticket links
    And the board caps its message at Telegram's 4096-character send limit

  # BL-502 pipeline-board-message-length-budget-01
  Scenario: a small board keeps every link and shows no overflow indicator
    Given a board whose grid, parked list and full link list together fit within the send limit
    When the board message is composed for sending
    Then the composed message is within the send limit
    And every ticket link is present in the message
    And no overflow indicator is shown

  # BL-502 pipeline-board-message-length-budget-02
  Scenario: an oversized link list is trimmed to fit and the omission is shown, never silent
    Given a board whose full tappable link list would push the composed message over the send limit
    When the board message is composed for sending
    Then the composed message is within the send limit
    And the grid and parked sections are present in full
    And only the links that fit the remaining budget are included
    And an overflow indicator naming the number of omitted links is shown

  # BL-502 pipeline-board-message-length-budget-03
  Scenario: the board still posts at a backlog size whose full links would exceed the limit
    Given a board whose full tappable link list would push the composed message over the send limit
    And Telegram rejects any message longer than the send limit
    When the board sync runs
    Then the board post succeeds instead of failing on length
    And the board is not left frozen

  # BL-502 pipeline-board-message-length-budget-04
  Scenario Outline: a text-too-long post failure is classified on its own class and keeps the board topic
    Given the board content changed and its post is rejected with the Telegram error "<error>"
    When the board sync attempts the post
    Then the post failure is classified as "<class>"
    And the board topic is "<topic_action>"

    Examples:
      | error                                 | class      | topic_action |
      | Bad Request: text is too long         | too-long   | retained     |
      | Bad Request: message thread not found | topic-gone | cleared      |
      | Too Many Requests: retry after 26     | transient  | retained     |
      | Bad Request: never-seen error text    | unknown    | retained     |
