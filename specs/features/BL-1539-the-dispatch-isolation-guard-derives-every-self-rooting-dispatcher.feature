# mutation-stamp: sha256=a9a297307a23f05285f0a2c7b75bd1042fe95030b12e0b16e7e3718b2d3573ee
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-14T01:35:45.807510131Z","feature_name":"BL-1539 The dispatch-isolation guard derives every self-rooting dispatcher","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1539-the-dispatch-isolation-guard-derives-every-self-rooting-dispatcher.feature","background_hash":"5836a5966ed73230330761fc2f5d2409f3f1d5dad0569bc144aecead8e16826c","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the derivation over the real scripts dir names each bb dispatcher","scenario_hash":"7b0a385a9f397d208f4f242b252cd5e97136662d89e8fe53ea3f2f8e134321da","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-14T01:35:45.807510131Z"},{"index":2,"name":"a test executing a bb dispatcher through the real scripts dir is flagged","scenario_hash":"6c94196d6e083bb9d43073adfab6888e93d8b733edba4b60750c883e224b0963","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-14T01:35:45.807510131Z"}]}
# acceptance-mutation-manifest-end

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
