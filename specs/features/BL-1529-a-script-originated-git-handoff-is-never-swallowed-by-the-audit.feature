Feature: BL-1529 A script-originated git_handoff is never swallowed by the audit

  swarm_handoff.sh answers the first invocation of a git_handoff draft with
  AUDIT_REQUIRED and HANDOFF_NOT_QUEUED and queues nothing; an agent reads
  that and calls again. salvage_lib's queue-handoff! (redo_from, reroute,
  reroute_resume) and handoffd's dispatch-gap auto-route! call once, read
  the zero exit as success, and report a checkpoint or a routed parcel
  that no inbox will ever receive. This feature is that a script sender
  either lands a handoff file or fails loud, with the audit left as it is.

  Background:
    Given a fixture project under mkdtemp with a coder worktree, a roles.tsv, and no standing audit challenge

  # BL-1529 script-sender-speaks-the-audit-01
  Scenario Outline: a salvage verb queues a real handoff under the two-call audit
    Given an active item with a prior handoff at the <stage> stage
    When <verb> is run for that item and <stage>
    Then exactly one handoff file exists in the coder outbox addressed to <stage>
    And the command's last output line names that file
    And no audit challenge is left standing for the sender

    Examples:
      | verb           | stage   |
      | redo_from.bb   | cleaner |
      | reroute.bb     | cleaner |

  # BL-1529 script-sender-speaks-the-audit-02
  Scenario: a salvage verb whose send never queues fails loud
    Given an active item with a prior handoff at the cleaner stage
    And swarm_handoff.sh is a stub that always answers HANDOFF_NOT_QUEUED
    When redo_from.bb is run for that item and cleaner
    Then the command exits non-zero
    And its output names the failure to queue
    And no handoff file exists in the coder outbox

  # BL-1529 script-sender-speaks-the-audit-03
  Scenario: the dispatch-gap auto-route lands a real handoff and logs only then
    Given an active ticket assigned to coder with no dispatch trail anywhere
    When the daemon's dispatch-gap sweep runs once
    Then exactly one git_handoff for that ticket exists in the coordinator outbox
    And the daemon log records a dispatch-gap-autoroute line for it

  # BL-1529 script-sender-speaks-the-audit-04
  Scenario: the dispatch-gap auto-route whose send never queues logs the error form
    Given an active ticket assigned to coder with no dispatch trail anywhere
    And swarm_handoff.sh is a stub that always answers HANDOFF_NOT_QUEUED
    When the daemon's dispatch-gap sweep runs once
    Then the daemon log records a dispatch-gap-autoroute-error line for it
    And no handoff file exists in the coordinator outbox

  # BL-1529 script-sender-speaks-the-audit-05
  Scenario: the two shell tests that observed the fault are green
    When swarmforge/scripts/test/test_redo_from.sh and test_reroute.sh run on the tree as it stands
    Then each prints ALL PASS and exits zero

  # BL-1529 script-sender-speaks-the-audit-06
  Scenario: the census of script senders is the one the ticket counted
    When every non-test script under swarmforge/scripts that drafts a git_handoff is listed
    Then the list names salvage_lib.bb and chase_sweep_lib.bb
    And the list has six entries
