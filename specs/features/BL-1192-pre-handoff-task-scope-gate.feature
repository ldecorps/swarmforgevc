# BL-531's pre-QA gate arms only when QA is among the recipients, so entangled
# tips ride cleaner → architect → hardender → documenter before QA discovers
# paths belonging to other tickets. On 2026-08-27 ten QA bounces classed
# `behavior` were predominantly this shape: a handoff naming one ticket carried
# a commit whose tree diff vs origin/main included other tickets' backlog YAML,
# feature files, or functional code (BL-596, BL-754, BL-980, BL-1174 evidence).
# QA's BL-506 check catches it at the end; this gate catches it at every hop.

Feature: Pre-handoff task-scope gate refuses entangled git_handoffs

  Background:
    Given a swarm repository whose roles send parcels with swarm_handoff.sh
    And origin/main is reachable from the sender's checkout

  # BL-1192 task-scope-gate-01
  Scenario Outline: a git_handoff is refused when its commit diff includes another ticket's functional paths
    Given a commit whose tree diff vs origin/main includes paths for ticket <foreign_ticket>
    When the coder sends a git_handoff for task ticket "<task_ticket>" citing that commit
    Then the send is <outcome>

    Examples:
      | foreign_ticket | task_ticket | outcome  |
      | BL-1185        | BL-1174     | refused  |
      | BL-980         | BL-596      | refused  |
      | none           | BL-1174     | accepted |

  # BL-1192 task-scope-gate-02
  Scenario: the refusal names the foreign ticket and sample paths
    Given a commit whose tree diff vs origin/main includes paths for ticket "BL-1185"
    When the documenter sends a git_handoff for task ticket "BL-1174" citing that commit
    Then the refusal reports the foreign ticket id
    And the refusal lists at least one conflicting path
    And the parcel is not delivered to any mailbox

  # BL-1192 task-scope-gate-03
  Scenario: the gate runs at every hop, not only the QA edge
    Given a commit whose tree diff vs origin/main includes paths for ticket "BL-980"
    When the cleaner sends a git_handoff for task ticket "BL-596" citing that commit
    Then the send is refused

  # BL-1192 task-scope-gate-04
  Scenario: evidence-only paths for the named task never block alone
    Given a commit whose tree diff vs origin/main touches only backlog/evidence for the named task
    When the documenter sends a git_handoff for task ticket "BL-1174" citing that commit
    Then the send is accepted

  # BL-1192 task-scope-gate-05
  Scenario: an unreadable origin/main warns and never blocks the send
    Given origin/main cannot be resolved from the sender checkout
    When the coder sends a git_handoff for task ticket "BL-1174" citing any commit
    Then the send is accepted
    And a warning records that the scope check could not run
