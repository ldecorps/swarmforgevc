Feature: BL-1539 The dispatch-isolation guard derives every self-rooting dispatcher

  test_shell_fixture_dispatch_isolation.sh (BL-998) keeps shell tests from
  dispatching a self-rooting helper through the REAL scripts dir, where it would
  claim a live parcel out of a real role's mailbox. Its first step derives the
  self-rooting set by piping each script's comment-stripped text into grep -q
  under set -euo pipefail. grep -q exits at its first match, sed dies of SIGPIPE
  writing the rest of a 16 KB dispatcher, pipefail reports 141, and the guard
  reads that as "not self-rooting" - ready_for_next.bb was kept 0 of 20 times.
  The regex also names run-dispatch! while done_with_current.bb has called
  run-dispatch-forwarding-args! since BL-652. Both fail open: the dispatcher
  silently leaves the set and the guard prints PASS. bl998's property runner is
  the only thing that noticed. This feature is that the derivation names both
  dispatchers, is pinned to a census, is stable across runs, and the runner is
  green.

  Background:
    Given the guard "swarmforge/scripts/test/test_shell_fixture_dispatch_isolation.sh" which derives the self-rooting scripts of a scripts dir

  # BL-1539 dispatch-isolation-guard-derives-every-self-rooting-dispatcher-01
  Scenario Outline: the derivation over the real scripts dir names each bb dispatcher
    When the guard derives the self-rooting scripts of "swarmforge/scripts"
    Then the derived set contains "<dispatcher>"

    Examples:
      | dispatcher           |
      | ready_for_next.bb    |
      | done_with_current.bb |

  # BL-1539 dispatch-isolation-guard-derives-every-self-rooting-dispatcher-02
  Scenario: the derivation is pinned to a census, so an empty or truncated derivation cannot pass
    When the guard derives the self-rooting scripts of "swarmforge/scripts"
    Then the derived set holds at least 30 scripts

  # BL-1539 dispatch-isolation-guard-derives-every-self-rooting-dispatcher-03
  Scenario Outline: a test executing a bb dispatcher through the real scripts dir is flagged
    Given a sandbox scripts dir holding the real "<dispatcher>" and the guard
    And a shell test in that sandbox that binds "$SCRIPT_DIR/../<dispatcher>" to a variable and executes it
    When the guard runs in that sandbox
    Then the guard exits non-zero and names that shell test

    Examples:
      | dispatcher           |
      | ready_for_next.bb    |
      | done_with_current.bb |

  # BL-1539 dispatch-isolation-guard-derives-every-self-rooting-dispatcher-04
  Scenario: the verdict on a large self-rooting file does not depend on scheduling
    Given a sandbox scripts dir holding only the real "ready_for_next.bb"
    When the guard derives the self-rooting scripts of that sandbox 20 times
    Then "ready_for_next.bb" is in the derived set every time

  # BL-1539 dispatch-isolation-guard-derives-every-self-rooting-dispatcher-05
  Scenario: the standing property runner is green
    When the standing suite runs "swarmforge/scripts/test/bl998_guard_membership_property_runner.bb"
    Then the run exits zero and reports no failed property check
