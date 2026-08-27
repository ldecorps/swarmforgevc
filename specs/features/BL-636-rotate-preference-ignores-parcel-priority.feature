Feature: mono-router rotation preference orders by handoff priority, not only recency

  # BL-636: preferred-rotate-target (mono_router_lib.bb) ordered rotation
  # candidates by newest-created-at only; priority (handoff-protocol.md's
  # 00-99 scale, lower first) was never consulted. Live incident 2026-07-25:
  # a priority-00 incident note starved 2h40 behind priority-50
  # rule_proposals because only recency was compared.
  #
  # Specifier ruling on the open question ("does a priority-00 note also
  # skip the note_actionable_after_ms aged-note gate?"): NO. This ticket
  # fixes ordering among rows already actionable; it does not change what
  # makes a row actionable in the first place. The aged-note gate (BL-576)
  # stays keyed on note broadcast character, not priority, so QA's five-way
  # merge-up broadcast is still protected from rotation thrash. Distinguishing
  # directed vs. broadcast notes for a faster incident path is left as a
  # follow-up, not silently folded into this fix.

  Background:
    Given a mono-router pack with config rotation router

  # BL-636 lower-priority-value-wins-01
  Scenario: a priority-00 row is preferred over a newer priority-50 row
    Given role "specifier" has actionable mail whose best priority is "00"
    And role "coder" has newer actionable mail whose best priority is "50"
    When the rotation target is computed
    Then "specifier" is selected

  # BL-636 equal-priority-newest-wins-02
  Scenario: at equal priority, the newest actionable mail still wins
    Given role "cleaner" and role "architect" both have actionable mail at priority "50"
    And role "architect" holds the newer parcel
    When the rotation target is computed
    Then "architect" is selected

  # BL-636 role-ranked-by-best-not-newest-priority-03
  Scenario: a role is ranked by its best (lowest) priority, not its newest parcel's priority
    Given role "specifier" holds actionable mail at priority "00" and a newer parcel at priority "70"
    And role "coder" holds actionable mail at priority "40"
    When the rotation target is computed
    Then "specifier" is selected

  # BL-636 missing-priority-defaults-safely-04
  Scenario: a parcel with unparseable or absent priority never jumps the queue
    Given role "coder" has actionable mail with no parseable priority
    And role "cleaner" has actionable mail at priority "90"
    When the rotation target is computed
    Then "coder" is not selected on the strength of its missing priority
    And "cleaner" is selected

  # BL-636 full-forge-unaffected-05
  Scenario: full-forge packs are unaffected by priority ordering
    Given a full-forge pack where every role is its own standing process
    When rotation preference logic would apply
    Then no shared-resident allocation decision is made

  # BL-636 aged-note-gate-unchanged-06
  Scenario: the aged-note actionable gate is unchanged by priority ordering
    Given a fresh priority-00 note broadcast to a dormant role
    And the note is younger than note_actionable_after_ms
    When the rotation target is computed
    Then the dormant role is not selected until the note ages into actionable
