Feature: The BL-035 rule_proposal shell test asserts the success grammar swarm_handoff.bb really emits
  test_rule_proposal.sh asserts "^HANDOFF QUEUED:" at three sites. swarm_handoff.bb
  has never printed that string: every success is "HANDOFF DELIVERED:",
  "HANDOFF QUEUED (mailbox only, no tmux inject):" or "HANDOFF QUEUED (daemon
  backup will deliver):". The first assertion therefore fails for every possible
  success, and under set -e the whole file aborts there — so BL-035's entire
  rule_proposal acceptance suite is dead, not just the three lines.
  Source: coordinator note 2026-08-01; BL-778.

  Background:
    Given the BL-035 rule_proposal shell test and its throwaway swarm fixture

  # BL-778 queue-grammar-01
  Scenario: the whole suite runs green against shipped swarm_handoff.bb
    When the BL-035 rule_proposal shell test runs
    Then every scenario in the file reports PASS
    And it exits zero

  # BL-778 queue-grammar-02
  Scenario Outline: the verdict does not depend on ambient delivery-mode environment
    Given the ambient environment carries <leaked variable>
    When the BL-035 rule_proposal shell test runs
    Then every scenario in the file reports PASS
    And it exits zero

    Examples:
      | leaked variable               |
      | SWARMFORGE_MAILBOX_ONLY=1     |
      | SWARMFORGE_SKIP_SYNC_INJECT=1 |
      | SWARMFORGE_SKIP_DAEMON=1      |
      | no delivery-mode variable     |

  # BL-778 queue-grammar-03
  Scenario Outline: a send that did not succeed still fails the assertion guarding it
    Given swarm_handoff.bb <fault> for a <draft> draft
    When the BL-035 rule_proposal shell test runs
    Then it fails naming assertion <assertion>
    And it exits non-zero

    Examples:
      | draft         | fault                          | assertion |
      | rule_proposal | rejects it and exits non-zero  | 01        |
      | rule_proposal | prints no success line at all  | 01        |
      | rule_proposal | queues no parcel to the outbox | 01        |
      | note          | prints no success line at all  | 04        |
