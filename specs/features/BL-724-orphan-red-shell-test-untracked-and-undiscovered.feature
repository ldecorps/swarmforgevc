Feature: Shell tests under scripts/test are discovered or explicitly excluded
  169 test_*.sh files live under swarmforge/scripts/test/ and nothing globs that
  directory, so an untracked or unreferenced test neither runs nor reports. One
  orphan red test sat there a week unnoticed. The discovery sweep makes that
  state loud instead of silent. Source: coder note 2026-07-30; BL-724.

  Background:
    Given a fixture checkout with a swarmforge/scripts/test directory

  # BL-724 discovery-01
  Scenario: a tracked test reached by the sweep is accounted for
    Given a tracked test file test_reached.sh
    When the discovery sweep runs
    Then the sweep accounts for test_reached.sh as reached
    And the sweep exits zero

  # BL-724 discovery-02
  Scenario: an explicitly excluded test is accounted for without running
    Given a tracked test file test_manual.sh excluded with the reason needs a live tmux server
    When the discovery sweep runs
    Then the sweep accounts for test_manual.sh as excluded
    And the sweep reports the reason needs a live tmux server
    And the sweep exits zero

  # BL-724 discovery-03
  Scenario Outline: every unaccounted state fails the sweep loudly
    Given the test directory is in state <state>
    When the discovery sweep runs
    Then the sweep names <file> as <label>
    And the sweep exits non-zero

    Examples:
      | state                        | file           | label                        |
      | untracked test file          | test_orphan.sh | untracked orphan             |
      | tracked but unlisted         | test_orphan.sh | unaccounted test             |
      | excluded with no reason       | test_bare.sh   | exclusion missing its reason |
      | exclusion for a deleted file | test_gone.sh   | stale exclusion              |

  # BL-724 discovery-04
  Scenario: an untracked test is never mistaken for a clean run
    Given a tracked test file test_reached.sh
    And the test directory is in state untracked test file
    When the discovery sweep runs
    Then the sweep exits non-zero
    And its output differs from a sweep over the tracked file alone

  # BL-724 discovery-05
  Scenario: the real orphan this ticket was filed for is reported
    Given the live repository checkout
    When the discovery sweep runs
    Then the sweep does not account for test_swarm_handoff_mono_router_auto_rotate.sh
