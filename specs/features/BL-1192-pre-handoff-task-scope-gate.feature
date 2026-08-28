# BL-531's pre-QA gate arms only when QA is among the recipients, so entangled
# tips ride cleaner → architect → hardender → documenter before QA discovers
# paths belonging to other tickets. On 2026-08-27 ten QA bounces classed
# `behavior` were predominantly this shape: a handoff naming one ticket carried
# a commit whose tree diff vs origin/main included other tickets' backlog YAML,
# feature files, or functional code (BL-596, BL-754, BL-980, BL-1174 evidence).
# QA's BL-506 check catches it at the end; this gate catches it at every hop.
#
# AMENDED 2026-08-28 (architect bounce, BL-1192-architect-bounce-20260828.md):
# the literal origin/main...commit range this ticket originally specified
# explodes into a false-positive avalanche on this repo's real git topology -
# a role's own branch legitimately accumulates many OTHER, already-forwarded
# tickets' commits (batch roles process several per turn; origin/main lags
# local work by design) long before origin/main catches up. Scope is now the
# union of each commit's own tree diff, walked first-parent from "the commit
# most recently handed off for this exact task" (the durable handoff archive,
# never grepped/guessed) up to the cited commit, counting only commits whose
# own message names this task's ticket id - a batch role's sibling-ticket
# commits in the same turn (tagged with THEIR OWN ticket id) contribute
# nothing, verified empirically against this repo's own real cleaner batch
# turn (scenario 06 below).

Feature: Pre-handoff task-scope gate refuses entangled git_handoffs

  Background:
    Given a swarm repository whose roles send parcels with swarm_handoff.sh

  # BL-1192 task-scope-gate-01
  Scenario Outline: a git_handoff is refused when its commit carries another ticket's functional paths
    Given a commit tagged for the task whose own diff includes paths for ticket <foreign_ticket>
    When the coder sends a git_handoff for task ticket "<task_ticket>" citing that commit
    Then the send is <outcome>

    Examples:
      | foreign_ticket | task_ticket | outcome  |
      | BL-1185        | BL-1174     | refused  |
      | BL-980         | BL-596      | refused  |
      | none           | BL-1174     | accepted |

  # BL-1192 task-scope-gate-02
  Scenario: the refusal names the foreign ticket and sample paths
    Given a commit tagged for the task whose own diff includes paths for ticket "BL-1185"
    When the documenter sends a git_handoff for task ticket "BL-1174" citing that commit
    Then the refusal reports the foreign ticket id
    And the refusal lists at least one conflicting path
    And the parcel is not delivered to any mailbox

  # BL-1192 task-scope-gate-03
  Scenario: the gate runs at every hop, not only the QA edge
    Given a commit tagged for the task whose own diff includes paths for ticket "BL-980"
    When the cleaner sends a git_handoff for task ticket "BL-596" citing that commit
    Then the send is refused

  # BL-1192 task-scope-gate-04
  Scenario: evidence-only paths for the named task never block alone
    Given a commit tagged for the task whose own diff touches only backlog/evidence for the named task
    When the documenter sends a git_handoff for task ticket "BL-1174" citing that commit
    Then the send is accepted

  # BL-1192 task-scope-gate-05
  Scenario: an unresolvable cited commit warns and never blocks the send
    When the coder sends a git_handoff for task ticket "BL-1174" citing an unresolvable commit
    Then the send is accepted
    And a warning records that the scope check could not run

  # BL-1192 task-scope-gate-06 (architect bounce D2: proves the accumulation
  # problem is actually solved, not merely narrowed on paper)
  Scenario: sibling tickets processed in the same batch turn are never mistaken for entanglement
    Given the task's own first commit was already handed off once
    And a sibling ticket's own commit lands on the same branch in between, tagged with its own id
    And the task's own follow-up commit lands after it, touching only its own paths
    When the cleaner sends a git_handoff for task ticket "BL-1174" citing the follow-up commit
    Then the send is accepted

  # BL-1192 task-scope-gate-07 (architect bounce round 2 D2: the acceptance
  # fixture previously could not distinguish "walk from last-handoff" from
  # "walk from origin/main under the abandoned_commits override" - this
  # scenario drives the real swarm_handoff.sh end to end with a
  # disconnected rebuild, mirroring task_scope_gate_lib_test_runner.bb's own
  # "abandoned base -> no findings" fixture at the acceptance level.
  Scenario: a deliberate rebuild off origin/main honours its own recorded abandonment
    Given an earlier commit on origin/main is already entangled with ticket "BL-1185"
    And a disconnected rebuild attempt repeats that same entanglement and was cited once
    When the cleaner sends a git_handoff for task ticket "BL-1174" citing a tip-pure rebuild that records the disconnected attempt as abandoned
    Then the send is accepted
