Feature: paused-ticket pager on the SwarmForge Telegram Mini App console

  # Human-requested 2026-07-19 (ldecorps): phone-glanceable triage for
  # backlog/paused/ — one ticket per page (id+title, YAML, Expedite); swipe
  # next/prev. Slice 4a of epic swarmforge-console / BL-517. Depends on
  # BL-516 (allowlisted operator channel + two-tap discipline) and rides the
  # same Mini App bridge host as BL-526 (console menu → pipeline grid /
  # resident spy).
  #
  # HOST (verified live 2026-07-19): Telegram Mini App HTML served by
  # extension/src/bridge/bridgeServer.ts (pre-auth shells like /console,
  # /pipeline-grid, /resident-spy; JSON/data routes stay token-gated). Add a
  # dedicated /paused-pager shell + a third button on the BL-526 console menu
  # (/console). Do NOT invent a second unauthenticated public page or a CLI.
  #
  # ORDER: paused tickets sorted by priority ascending (lower number = higher
  # urgency), then by ticket id ascending. Navigation STOPS at the ends (no
  # wrap) — next on the last item and previous on the first are no-ops that
  # keep the current ticket visible.
  #
  # HIGHEST PRIORITY: literal numeric priority 0 (project critical floor).
  #
  # EXPEDITE: reuse BL-490's force-promote + dispatch-to-build meaning for a
  # paused ticket (promote paused→active when needed and jump the swarm's
  # next-work path). Do NOT invent a second approval/promote path. Gate the
  # destructive control with the same two-tap confirm discipline as BL-516
  # /ensure. After a successful expedite, advance to the next remaining
  # paused ticket (recomputed after the promote) or show the empty state.
  #
  # SCOPE OUT: editing arbitrary YAML fields beyond priority/expedite; bulk
  # multi-select; replacing the pipeline board LINKS list (BL-506/BL-513).
  #
  # HUMAN REVIEW: feature file amended 2026-07-19 after a wrong CLI-shaped
  # .md draft — please confirm layout / stop-at-ends / priority-0 pins.

  Background:
    Given the SwarmForge bridge Mini App is reachable with my allowlisted console token
    And the console menu at /console is available

  # BL-538 paused-pager-open-01
  Scenario: opening the pager shows one paused ticket with id, title, YAML, and Expedite
    Given at least one ticket exists under backlog/paused/
    When I open the paused-ticket pager from the console menu
    Then the page shows that ticket's id and title at the top
    And shows the ticket YAML in the middle
    And shows a "Set highest priority, expedite" control at the bottom

  # BL-538 paused-pager-empty-02
  Scenario: the pager shows an empty state when nothing is paused
    Given backlog/paused/ has no tickets
    When I open the paused-ticket pager
    Then I see a clear empty state and no Expedite control

  # BL-538 paused-pager-swipe-03
  Scenario: swipe or next/prev moves between paused tickets with the same layout
    Given two or more tickets exist under backlog/paused/
    And I am viewing the first paused ticket on the pager
    When I go to the next paused ticket
    Then a different paused ticket is shown with id and title at the top, YAML in the middle, and Expedite at the bottom
    And the tickets are ordered by priority ascending then id ascending

  # BL-538 paused-pager-ends-04
  Scenario: navigation stops at the first and last paused ticket
    Given I am viewing the last paused ticket on the pager
    When I try to go to the next paused ticket
    Then the same ticket remains visible
    And when I am on the first ticket and try to go previous, the first ticket remains visible

  # BL-538 paused-pager-expedite-confirm-05
  Scenario: Expedite asks for confirm before mutating
    Given a paused ticket is shown on the pager
    When I tap "Set highest priority, expedite"
    Then I am asked to confirm and the ticket is not yet mutated

  # BL-538 paused-pager-expedite-06
  Scenario: confirmed Expedite sets priority 0, jumps the queue, and advances
    Given a paused ticket is shown on the pager
    When I confirm "Set highest priority, expedite"
    Then that ticket's priority becomes 0
    And the ticket is expedited onto the swarm's next-work path using the BL-490 promote/dispatch effect
    And the pager advances to another paused ticket or the empty state

  # BL-538 paused-pager-approve-07
  Scenario: Approve is shown only for paused tickets awaiting human approval
    Given a paused ticket with human_approval pending is shown on the pager
    Then I see an Approve control
    And I do not see Approve on paused tickets that are not pending approval

  # BL-538 paused-pager-approve-08
  Scenario: confirmed Approve records human_approval without promoting
    Given a paused ticket with human_approval pending is shown on the pager
    When I confirm Approve
    Then that ticket's human_approval becomes approved
    And the ticket remains under backlog/paused/
    And the pager refreshes to show the updated YAML
