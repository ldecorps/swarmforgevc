Feature: A revert commit does not blame the ticket whose subject it inherited

  task_scope_gate_lib.bb decides which commits belong to the task being sent
  with commit-message-names-task?, which reads the commit SUBJECT and takes
  the first ticket id in it. A revert produced by `git revert` has the
  subject `Revert "<the original subject>"`, so it inherits the reverted
  commit's ticket id verbatim and the gate reads the revert as a commit
  belonging to that ticket. The revert's diff is then scanned for foreign
  paths exactly as if the ticket had written it.

  A revert of a merge undoes whatever that merge carried, so its diff names
  every path the merge touched - including files belonging to other tickets.
  The gate therefore reports the ticket as entangled with foreign scope on
  the strength of a commit that only REMOVED content, and refuses the send.

  Observed 2026-08-30 on BL-1240, blocked at the documenter to QA hop:
  commit 3825f91cd `Revert "Merge documenter BL-1240 0ca3bc03c0 into QA. By
  QA."` sits inside the walk from the ticket's last handoff commit, and its
  diff names docs/how-to/BL-973-bb-fixture-closure-guards-and-suite-inventory.md.
  No ticket field can exempt it: abandoned_commits only rewrites the walk's
  BASE when the base itself is listed, and the acceptance/retires path
  exemptions would have to claim scope the ticket does not own.

  This is the third over-match shape this same predicate has been hardened
  against; the first two, both recorded in its own comment, were a body
  substring match and a multi-id subject.

  Background:
    Given a scope gate walking a parcel's commits since its last handoff

  # BL-1295 revert-subject-does-not-blame-the-reverted-ticket-01
  Scenario: A revert does not claim the ticket id its subject inherited
    Given a revert commit whose subject is Revert quoting an earlier subject that names the task
    When the gate decides which commits belong to the task
    Then the revert commit is not among them

  # BL-1295 revert-subject-does-not-blame-the-reverted-ticket-02
  Scenario: A commit that genuinely names the task and touches a foreign path is still refused
    Given a commit whose own subject names the task and whose diff touches a path belonging to another ticket
    When the gate decides whether the handoff may be sent
    Then the handoff is refused
    And the refusal names the foreign path

  # BL-1295 revert-subject-does-not-blame-the-reverted-ticket-03
  Scenario: A parcel whose only foreign path comes from a revert may be sent
    Given the walk contains a revert of an earlier merge of the task
    And the only foreign path in the walk appears solely in that revert
    When the gate decides whether the handoff may be sent
    Then the handoff is allowed
