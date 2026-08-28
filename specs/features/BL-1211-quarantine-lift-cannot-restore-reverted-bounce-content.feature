Feature: BL-1211 restoring a collapsed branch never resurrects content a bounce deliberately removed

  Two rules govern a review branch, and on 2026-08-27 they contradicted each
  other with nobody able to tell.

  A bounce must be reverted out of the bouncing branch, and the check is that
  the CONTENT is gone - ancestry proves nothing. A branch recovered from a
  collapse must be missing nothing relative to its siblings, and the check is
  that merging it deletes nothing from them. A branch whose sibling still holds
  the bounced content cannot satisfy both: restoring everything the sibling has
  is exactly what drives the deletion diff to zero, and it restores the bounced
  content along with everything else.

  That is what happened. A revert removed 511 lines of bounced work; a recovery
  four minutes later restored two of those files from a sibling branch; the
  deletion diff read zero and the quarantine was lifted. The revert commit is
  still an ancestor and its content is byte-identical to what it removed.

  The recovery must therefore know what was deliberately removed, and the lift
  check must be able to fail on content that came back - not only on content
  that went missing.

  What separates the two cases is authorship, not byte-identity. A correct
  re-fix may reinstate removed content verbatim and deliberately; that must
  lift. Content that merely reappeared, with no commit standing behind it,
  must not. Identity is what makes the question worth asking, never the
  answer to it.

  Background:
    Given a review branch that bounced a ticket and reverted that ticket's content out

  # BL-1211 quarantine-lift-cannot-restore-reverted-bounce-content-01
  Scenario: a recovery from a sibling does not bring back reverted bounce content
    Given the sibling branch still holds the reverted content
    When the branch is recovered from that sibling
    Then the reverted content is still absent from the recovered branch
    And every other file the recovery was meant to restore is present

  # BL-1211 quarantine-lift-cannot-restore-reverted-bounce-content-02
  Scenario: the lift check refuses a branch carrying content a bounce removed
    Given the recovered branch has an empty deletion diff against its siblings
    And it carries content identical to what a revert on it removed
    And no commit after that revert authored the content back
    When the quarantine lift check runs
    Then the lift is refused
    And the refusal names the ticket whose bounced content came back

  # BL-1211 quarantine-lift-cannot-restore-reverted-bounce-content-03
  Scenario: a clean recovery still lifts
    Given the recovered branch has an empty deletion diff against its siblings
    And it carries no content that a revert on it removed
    When the quarantine lift check runs
    Then the lift is granted

  # BL-1211 quarantine-lift-cannot-restore-reverted-bounce-content-04
  Scenario: a genuine re-fix answering the bounce is not mistaken for the reverted content
    Given the branch has merged new work that answers the bounce
    And that work differs from the content the revert removed
    When the quarantine lift check runs
    Then the lift is granted

  # BL-1211 quarantine-lift-cannot-restore-reverted-bounce-content-05
  Scenario: a verbatim reinstatement that a later commit deliberately authored still lifts
    Given a commit after the revert reinstated the removed content deliberately
    And the reinstated content is byte-identical to what the revert removed
    When the quarantine lift check runs
    Then the lift is granted
    And the lift cites the commit that authored the content back

  # BL-1211 quarantine-lift-cannot-restore-reverted-bounce-content-06
  Scenario: an operator can reach the lift verdict without writing code
    Given the branch carries content the bounce removed, with no commit authoring its return
    When an operator runs the quarantine-lift check against that branch
    Then the check refuses the lift
    And it names the path whose return is unauthorized

  # BL-1211 quarantine-lift-cannot-restore-reverted-bounce-content-07
  Scenario: the operator-facing check fails closed when it cannot decide
    Given the branch's bounce history cannot be resolved
    When an operator runs the quarantine-lift check against that branch
    Then the check refuses the lift
    And it reports that it could not decide, rather than reporting the branch clean
