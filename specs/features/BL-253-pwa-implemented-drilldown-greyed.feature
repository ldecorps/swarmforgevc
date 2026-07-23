# mutation-stamp: sha256=01d9bd76e2d0ad5d0be3f7ec7258b7dea0b8025596b2eb098184744a47e6fe38
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-10T16:15:32.205805418Z","feature_name":"the phone docs drill-down distinguishes implemented tickets from not-yet-implemented ones","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-253-pwa-implemented-drilldown-greyed.feature","background_hash":"e7eacb4436a97ed7dee2efc2cccaea5219f2cd887cf44479af94cdb88c38ed7f","implementation_hash":"unknown","scenarios":[{"index":0,"name":"implementation status derives from the backlog folder and greys the not-yet items","scenario_hash":"b22b4df3ef16bed8f0b86fff1ff7d504aad180e46d76ae0e34e0e6b52878586d","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-07-10T16:15:22.181007808Z"},{"index":2,"name":"a ticket's Gherkin can be refined regardless of implementation status","scenario_hash":"c703c3c79d55e4a5aeef3d0776d7fb0f9ab47dc1324bbeeddbcddba83320e86e","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-10T16:15:22.181007808Z"}]}
# acceptance-mutation-manifest-end

Feature: the phone docs drill-down distinguishes implemented tickets from not-yet-implemented ones

  # Operator request (2026-07-10, via coordinator intake, PRIORITIZED): enhance the
  # existing BL-117 phone docs drill-down (milestone -> ticket -> Gherkin) with an
  # implementation-status dimension, so the tree reads "here's what's shipped, and
  # here's what's still to come". Not-yet-implemented tickets stay visible but greyed.
  #
  # REUSE (not a new tree): BL-117 (done) already renders the drill-down and each
  # TicketNode already carries a folder-authoritative status (done|active|paused);
  # BL-150 (done) provides gherkin recertification on that surface. Implementation
  # status DERIVES from existing git-visible state ("the repo is the API") — no new
  # authoritative store.
  #
  # Operator decisions (2026-07-10, via specifier questions):
  #  1. GRANULARITY: whole-ticket — a ticket in done/ is implemented; active/ or
  #     paused/ is not-yet-implemented (greyed). Not per-scenario.
  #  2. INTERACTION: greyed = visually muted but FULLY interactive. Greying is a
  #     visual treatment only — it disables nothing. You can drill in and read the
  #     planned scenarios AND still REFINE a not-yet-implemented ticket's Gherkin via
  #     the BL-150 recertification/update flow (operator refinement 2026-07-10:
  #     "we should still be able to refine a gherkin that has not been implemented
  #     yet" — refining planned specs pre-build is valuable). Recertification
  #     (confirm/update/delete) stays available regardless of implementation status.
  #  Localize new PWA strings via the existing pwa/locales.js mechanism.

  Background:
    Given the phone docs drill-down tree over milestones, tickets, and their Gherkin scenarios

  # BL-253 status-from-folder-01
  Scenario Outline: implementation status derives from the backlog folder and greys the not-yet items
    Given a ticket in the "<folder>" backlog folder
    When the docs drill-down renders it
    Then it is shown as "<treatment>"

    Examples:
      | folder | treatment                     |
      | done   | implemented and not greyed    |
      | active | greyed as not-yet-implemented |
      | paused | greyed as not-yet-implemented |

  # BL-253 not-yet-expandable-02
  Scenario: a greyed not-yet-implemented ticket stays expandable
    Given a not-yet-implemented ticket in the tree
    When the operator taps it
    Then it expands to show its planned scenarios

  # BL-253 refine-regardless-of-status-03
  Scenario Outline: a ticket's Gherkin can be refined regardless of implementation status
    Given a "<status>" ticket with a live Gherkin scenario
    When the operator refines that scenario in the recertification flow
    Then the proposed edit is accepted for specifier review

    Examples:
      | status      |
      | implemented |
      | not-yet     |

  # BL-253 greying-is-visual-only-04
  Scenario: greying is a visual treatment only and disables no interaction
    Given a not-yet-implemented ticket in the tree
    When the operator uses its recertification controls
    Then they behave exactly as they do for an implemented ticket

  # BL-253 labels-localized-05
  Scenario: the implemented and not-yet labels are localized
    Given the phone app language is set to a supported non-default locale
    When the docs drill-down renders implemented and not-yet tickets
    Then the implemented and not-yet labels appear in that locale
