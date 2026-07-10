# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-10T17:48:35.729414233Z","feature_name":"the PWA and daily briefing list the tickets whose feature file needs human approval","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-251-list-tickets-needing-human-approval.feature","background_hash":"ed6a8e78123af6b22267de87c7f4c28736299ad63ace6b59ff144af59cd41d5f","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: the PWA and daily briefing list the tickets whose feature file needs human approval

  # Operator request (2026-07-10, via coordinator): surface, in the phone PWA and
  # the daily briefing email, the tickets that are waiting on human approval — so
  # the operator sees their approval to-do without digging through the backlog.
  #
  # Operator decisions (via specifier questions):
  #  1. SIGNAL: a structured backlog field human_approval: pending|approved is the
  #     source of truth (today it is only a free-text "# HUMAN APPROVAL: ... pending"
  #     comment, too brittle to list from); a one-time backfill seeds the field on
  #     live items from those comments.
  #  2. SCOPE: only specifier-authored feature files pending human review (the APS
  #     human-approval rule) — the concrete class that exists today.
  #  3. INTERACTION: list / read-only — both surfaces SHOW the pending tickets;
  #     approving still happens as it does today (no approve/reject from the phone).
  #
  # Single source: both surfaces read the human_approval FIELD (never re-parse the
  # prose comment), so the PWA and the briefing can never disagree. The list covers
  # LIVE items only (backlog/active + backlog/paused). Buildable now — PWA
  # (pwa/app.js renders backlog.json from backlogDashboard.ts), briefing
  # (briefing_email_lib.bb), and the backlog reader all exist.

  Background:
    Given backlog items, each with a human_approval field that is "pending", "approved", or unset

  # BL-251 pwa-lists-pending-01
  Scenario: the PWA lists exactly the tickets whose feature file needs human approval
    Given a live ticket "A" whose human_approval is "pending"
    And a live ticket "B" whose human_approval is "approved"
    When the operator opens the PWA
    Then the needs-approval list shows "A" with its id and title
    And it does not show "B"

  # BL-251 briefing-lists-pending-02
  Scenario: the daily briefing lists the tickets needing human approval
    Given a live ticket "A" whose human_approval is "pending"
    When the daily briefing is produced
    Then the briefing lists "A" by its id and title in a needs-approval section

  # BL-251 single-source-03
  Scenario: the PWA and the briefing derive the list from the same field
    Given a live ticket "A" whose human_approval is "pending"
    When both the PWA and the daily briefing render the needs-approval list
    Then both show "A", read from the human_approval field rather than a parsed comment

  # BL-251 empty-state-04
  Scenario: an empty needs-approval list renders gracefully
    Given no live ticket has human_approval "pending"
    When the needs-approval list is rendered
    Then it shows an explicit nothing-awaiting-approval state rather than an error or a blank

  # BL-251 backfill-seeds-field-05
  Scenario Outline: the one-time backfill seeds the field from existing approval comments
    Given a live ticket predating the field whose comment marks it "<comment>"
    When the backfill runs
    Then its human_approval is set to "<value>"

    Examples:
      | comment              | value    |
      | pending human review | pending  |
      | approved by operator | approved |
