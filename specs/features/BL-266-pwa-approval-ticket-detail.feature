Feature: read a pending ticket's description and acceptance scenarios from the phone approval list

  # Operator request (2026-07-10, via coordinator, backlog/INTAKE-pwa-read-pending-
  # ticket-detail.md): BL-251 shipped a needs-approval list in the PWA that renders
  # only id + title, so the operator sees WHICH tickets await approval but cannot READ
  # what they are approving. This adds a read-only drill-in: tap a needs-approval entry
  # to read the ticket's description and its acceptance (Gherkin) scenarios.
  #
  # Reuse (verified live 2026-07-10): docs-tree.json (docsTree.ts) ALREADY carries every
  # ticket's description + resolved acceptance scenarios for ALL statuses, including a
  # paused human_approval:pending ticket (the "implemented" flag is only a visual-greying
  # signal, not a data filter). The PWA already fetches docs-tree.json and renders docs
  # scenarios (BL-117). So the detail is a cross-reference from the needs-approval entry
  # (by ticket id) into the already-fetched docs-tree — no new store, no second parser,
  # and no divergent copy of the ticket. READ-ONLY: approving from the phone is a separate
  # control action (gap #10) and is explicitly OUT OF SCOPE here.

  Background:
    Given the phone app's needs-approval list of tickets pending human approval

  # BL-266 approval-detail-shows-description-and-scenarios-01
  Scenario: opening a pending ticket reveals its description and acceptance scenarios
    Given a pending ticket "A" with a description and acceptance scenarios
    When the operator opens "A" from the needs-approval list
    Then its description is shown
    And its acceptance scenarios are shown

  # BL-266 approval-detail-single-source-02
  Scenario: the detail matches the committed ticket the swarm builds against
    Given a pending ticket "A" with a description and acceptance scenarios
    When the operator opens "A" from the needs-approval list
    Then the description and scenarios shown are those of "A"'s committed ticket and its feature file
    And no separately-stored or divergent copy is shown

  # BL-266 approval-detail-read-only-03
  Scenario: the detail view offers no approve or reject action
    Given a pending ticket "A" with a description and acceptance scenarios
    When the operator opens "A" from the needs-approval list
    Then the detail view offers no approve, reject, or other write action

  # BL-266 approval-detail-unavailable-state-04
  Scenario: a pending ticket with no resolvable scenarios shows a localized empty state
    Given a pending ticket "A" whose acceptance scenarios cannot be resolved
    When the operator opens "A" from the needs-approval list
    Then a localized empty state is shown rather than an error or a blank

  # BL-266 approval-detail-localized-05
  Scenario: the detail view renders in the active locale
    Given a pending ticket "A" with a description and acceptance scenarios
    And the active locale is not the default
    When the operator opens "A" from the needs-approval list
    Then the detail view's own labels render in the active locale
