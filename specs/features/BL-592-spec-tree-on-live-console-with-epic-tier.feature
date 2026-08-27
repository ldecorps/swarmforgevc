Feature: the live Mini App console exposes a read-only spec tree Milestone to Epic to BL item to Gherkin

  # BL-592 ports BL-117's docs drill-down to the LIVE holistic console (token-
  # authed bridge), not the static backlog-dashboard PWA, and inserts an Epic
  # tier between Milestone and ticket. computeDocsTree / gherkinScenarios are
  # reused; new work is Epic grouping, schema v2, bridge serving, and live UI.

  Background:
    Given the live Mini App console spec tree screen is open

  # BL-592 live-console-drill-path-01
  Scenario: full drill path from milestone to Gherkin on the live console
    When the human opens a milestone
    And drills into an epic under that milestone
    And drills into a BL item under that epic
    Then the BL item's Gherkin scenarios are shown as readable scenario text
    And the tree data is served fresh from the bridge over the live checkout

  # BL-592 epic-groups-by-field-02
  Scenario: epics group tickets by the epic field
    Given a milestone with tickets carrying different epic values
    When the human opens that milestone
    Then each distinct epic value appears as its own epic node
    And each epic node lists only tickets whose epic field matches that epic

  # BL-592 no-epic-bucket-03
  Scenario: a ticket without an epic field falls into a visible no-epic bucket
    Given a milestone with a ticket that has no epic field
    When the human opens that milestone
    Then a visible "(no epic)" epic node exists under that milestone
    And the ticket appears under that bucket
    And the ticket is not dropped from the tree

  # BL-592 epic-tracker-is-header-not-leaf-04
  Scenario: an epic tracker ticket is the epic node header not a sibling leaf
    Given a paused epic tracker ticket whose id matches its epic field
    And member tickets under that epic
    When the human drills into that epic on the live console
    Then the epic node title comes from the tracker ticket
    And the tracker ticket is not listed again as a navigable ticket leaf under its own epic

  # BL-592 cross-milestone-epic-modelling-05
  Scenario Outline: a cross-milestone epic appears under each milestone its members touch
    Given an epic whose member tickets span <milestones>
    When the human opens each affected milestone on the live console
    Then the epic node appears under that milestone
    And only tickets whose milestone field equals that milestone are listed under the epic there

    Examples:
      | milestones        |
      | M8 and M9         |

  # BL-592 read-only-gate-06
  Scenario: navigating the spec tree is read-only
    Given any level of the live console spec tree
    Then no affordance exists to edit documentation or create or modify tickets

  # BL-592 schema-version-pwa-not-broken-07
  Scenario: bumping the docs-tree schema version does not silently break the static PWA explorer
    Given the docs tree schema version has been bumped for the epic tier
    When the static backlog-dashboard PWA loads its published docs-tree artifact
    Then the PWA documentation explorer still drills from milestone to ticket to Gherkin
    And no published PWA fetch fails because of the new schema alone

  # BL-592 static-pwa-surface-unchanged-08
  Scenario: the spec tree is not served from the static PWA artifact
    Given the static backlog-dashboard PWA
    When the app user browses available surfaces
    Then the live-console spec tree route is not reachable from the static PWA
    And the static PWA remains a git-SHA reproducible projection with no bridge write path
