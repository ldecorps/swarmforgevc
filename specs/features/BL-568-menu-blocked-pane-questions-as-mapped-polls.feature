Feature: BL-568 menu-blocked pane questions as mapped Telegram polls
  # When a role pane is blocked on a Claude Code AskUserQuestion (or kin)
  # menu, front desk auto-surfaces a native poll in that role's steering
  # topic and drives the menu only from the human's poll_answer. Never
  # auto-pick options. Ordinary steers while menu-blocked get a receipt.
  #
  # Design lock (specifier 2026-08-25):
  # - Detect via chase_sweep / pane-capture: menu footer
  #   ("Enter to select … Tab/Arrow … Esc"), checkbox glyphs, numbered
  #   options, wizard tab strip. Menu-blocked is BLOCKED, not idle.
  # - Mapping kind menu-answer: role, pane/session id, option order, menu
  #   fingerprint. Reuse BL-466 sendPoll + recordPollMapping; is_anonymous
  #   false; allows_multiple_answers mirrors the menu.
  # - Telegram caps: question <=300, options <=10, option text <=100 —
  #   truncate with ellipsis; >10 options or unusable length → text
  #   fallback naming the RC session (no blind poll).
  # - Free-text menu option: poll choice converts to "reply in topic after
  #   poll"; inject follow-up text only once the menu is in text-entry.
  # - Before keystrokes: re-capture; fingerprint must match surface-time
  #   or drop with receipt — never type blind.
  # - BL-566 gains menu_blocked receipt outcome for ordinary steers.
  # - Timeout: leave menu untouched; re-notify once (no auto-answer).

  # BL-568 detect-and-surface-poll-01
  Scenario: AskUserQuestion menu yields a non-anonymous poll in the role topic
    Given a role pane whose capture shows an AskUserQuestion menu with at most 10 options under Telegram length caps
    When the next chase/sweep cadence runs
    Then a non-anonymous poll is posted in that role's steering topic
    And poll options mirror the menu (multi-select mirrored when the menu is multi-select)
    And a menu-answer mapping records role pane identity option order and fingerprint

  # BL-568 over-cap-text-fallback-02
  Scenario: menus that exceed Telegram poll caps fall back to text naming RC
    Given a menu with more than 10 options or question/option text that cannot truncate usefully under Telegram caps
    When the menu is surfaced
    Then the topic receives a text fallback naming the RC session
    And no poll is posted that would lie about the option set

  # BL-568 poll-answer-drives-menu-03
  Scenario: poll_answer keystrokes select the voted options and advance
    Given a live menu-answer mapping whose fingerprint still matches the pane
    When the human's poll_answer arrives
    Then the front desk injects keystrokes that select exactly the voted options
    And a multi-step wizard repeats detect-surface-drive for the next question

  # BL-568 stale-fingerprint-drops-04
  Scenario: changed or cleared menu drops the vote with a receipt
    Given a menu-answer mapping whose fingerprint no longer matches the live pane
    When the human's poll_answer arrives
    Then no keystrokes are injected
    And the topic receives an explanatory receipt

  # BL-568 steer-while-menu-blocked-05
  Scenario: ordinary steers while menu-blocked are not injected
    Given a pane that is menu-blocked with a live poll outstanding
    When a plain steer message arrives for that role topic
    Then the message is not injected into the pane
    And the sender receives a menu_blocked delivery receipt referencing the poll

  # BL-568 free-text-option-handoff-06
  Scenario: free-text menu option converts to a guarded text hand-off
    Given a menu whose free-text option was elected via the poll
    When the human replies in-topic with the free text
    Then that follow-up is injected only after the menu reaches its text-entry state
    And earlier plain steers remain blocked per menu_blocked receipts

  # BL-568 no-auto-answer-on-timeout-07
  Scenario: timeout leaves the menu untouched and re-notifies once
    Given a surfaced menu poll that receives no human vote before the await window
    When the await window elapses
    Then the pane menu is left untouched (no auto-selected options)
    And the topic is re-notified at most once
