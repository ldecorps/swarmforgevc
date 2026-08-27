Feature: Note actionability threshold sits below the flow-watchdog warn tier

  # BL-780: note_actionable_after_ms (20m) outran flow_watchdog_warn_ms (15m),
  # so aged notes alarmed the human before rotation could act. Shipped defaults
  # must order every rotation-actionability threshold below the warn tier; an
  # inverted operator conf is reported at daemon start, never silently accepted.
  # BL-576 broadcast-thrash protection is unchanged.

  Background:
    Given a mono-router pack whose home resident is coder

  # BL-780 default-ordering-01
  Scenario: the shipped note actionability default sits below the flow-watchdog warn default
    Given the default note_actionable_after_ms
    And the default flow_watchdog_warn_ms
    When the two thresholds are compared
    Then the note actionability threshold is lower than the warn threshold

  # BL-780 inverted-conf-reported-at-startup-02
  Scenario Outline: an inverted threshold ordering is reported once at daemon start
    Given the effective config sets note_actionable_after_ms to <note_ms> and flow_watchdog_warn_ms to <warn_ms>
    When handoffd starts against that config
    Then the daemon log contains "config-threshold-inversion"
    And the daemon log names both threshold values
    And handoffd continues running

    Examples:
      | note_ms | warn_ms |
      | 1200000 | 900000  |
      | 900000  | 600000  |

  # BL-780 bl576-broadcast-thrash-unchanged-03
  Scenario: a five-role aged broadcast drains one role at a time, never mid-turn
    Given the specifier, cleaner, architect, hardender and documenter each hold an aged merge-up note
    When the chase sweeps repeatedly while the resident finishes each drain
    Then at most one rotation is performed per sweep
    And no rotation is performed within the rotate cooldown of the previous one
    And no rotation is performed while the resident pane shows a busy footer
    And the resident returns to coder between drains
    And all five mailboxes end empty with no human action

  # BL-780 shipped-default-ten-minutes-04
  Scenario: the shipped default note actionability threshold is ten minutes
    Given no note_actionable_after_ms override in the effective config
    When the aged-note threshold is resolved
    Then the threshold is 10 minutes
