Feature: BL-2024 QA's gather skips the unit and property lanes for a backlog-only parcel

  QA was the top dwell hotspot of the 2026-10-06 shift: 51 tickets passed
  QA, 23 of them review-only stamp-offs, at about 14 minutes of processing
  each. The gather's unit and property lanes took 7.3 to 8.8 minutes of
  every pass (twelve QA gather reports, 2026-10-05). A parcel whose own
  diff - from its merge-base with main to the parcel commit - touches only
  backlog/ changes nothing those lanes test: running them measures main,
  which every other parcel and the standing-red register already measure.
  So for such a parcel the gather reports both rows skipped, with the
  reason, and still runs everything else. Any path outside backlog/, or a
  diff it cannot compute, runs both lanes as before.

  # BL-2024 backlog-only-parcel-skips-unit-and-properties-01
  Scenario: a parcel whose own diff touches only backlog/ skips the unit and property lanes
    Given a fixture repository whose parcel commit adds only "backlog/evidence/BL-9001-coder.md" on top of main
    When the QA gather runs for that parcel commit
    Then the unit row and the properties row read skipped, naming the backlog-only diff
    And neither npm test nor npm run test:properties was started
    And the acceptance row ran

  # BL-2024 a-path-outside-backlog-runs-both-lanes-02
  Scenario Outline: a parcel whose own diff touches any path outside backlog/ runs both lanes
    Given a fixture repository whose parcel commit adds "backlog/evidence/BL-9001-coder.md" and "<path>" on top of main
    When the QA gather runs for that parcel commit
    Then the unit row and the properties row ran

    Examples:
      | path                                 |
      | extension/src/tools/bl9001.ts        |
      | specs/pipeline/steps/bl9001Steps.js  |
      | swarmforge/scripts/bl9001.bb         |
      | docs/how-to/BL-9001-fixture.md       |

  # BL-2024 an-unresolvable-diff-runs-both-lanes-03
  Scenario: a parcel whose merge-base with main cannot be resolved runs both lanes
    Given a fixture repository with no main branch
    When the QA gather runs for its HEAD commit
    Then the unit row and the properties row ran

  # BL-2024 a-rename-into-backlog-runs-both-lanes-04
  Scenario: a parcel that renames a file out of extension/src into backlog/ runs both lanes
    Given a fixture repository whose parcel commit renames "extension/src/tools/bl9001.ts" to "backlog/bl9001.ts" on top of main
    When the QA gather runs for that parcel commit
    Then the unit row and the properties row ran
