Feature: BL-1208 a revert instruction is earned by authorship of the live content, never by its liveness alone

  The bounce revert check answers "is the bounced content still live at the
  bouncing branch's tip". When it is, the check emits verdict violation and a
  ready-to-paste `git revert` command. That inference holds only if the commit
  it was handed actually introduced the content being complained about. It has
  no input that establishes this, and content-is-live is equally true of every
  healthy commit on the branch - so any commit named on the command line, by
  typo or by mistake, is answered with a destructive instruction stated with
  full confidence.

  It fired this way on 0bf05774a, the commit that recovered thirteen files a
  previous recovery had silently dropped. All thirteen were restored from a
  sibling review branch, so all thirteen read as live, and the check offered to
  revert them - which would have re-deleted them, including BL-592's own
  implementation, re-creating the silent loss that took two rounds of evidence
  to find.

  The fix is not to relax the check into silence. A commit whose bounced
  content is live is still a finding and must still be reported with its files
  named - BL-954 exists because a silent clean is the worse failure. What must
  be withheld is the destructive half: the revert instruction is offered only
  when the check positively established that this commit authored the live
  content, rather than restored content that already existed elsewhere.

  Background:
    Given a bouncing review branch and a commit named to the bounce revert check

  # BL-1208 revert-remedy-requires-authorship-not-liveness-01
  Scenario: a commit that restores content it did not author is never answered with a revert instruction
    Given the commit only restores paths whose content already exists identically on a sibling review branch
    When the bounce revert check runs
    Then no revert instruction is offered
    And the verdict is not clean
    And every live path is still named in the finding

  # BL-1208 revert-remedy-requires-authorship-not-liveness-02
  Scenario: a genuine unreverted bounce still gets its revert instruction
    Given the commit authored the live content and that content is still at the tip
    When the bounce revert check runs
    Then the verdict is a violation
    And a revert instruction naming the commit and the bouncing branch is offered

  # BL-1208 revert-remedy-requires-authorship-not-liveness-03
  Scenario: content appearing elsewhere by coincidence does not clear a real bounce
    Given the commit authored the live content and that same content also appears on a sibling review branch
    When the bounce revert check runs
    Then the verdict is a violation
    And a revert instruction naming the commit and the bouncing branch is offered

  # BL-1208 revert-remedy-requires-authorship-not-liveness-04
  Scenario: published history is still reported without a revert instruction
    Given the commit is already an ancestor of a published main branch
    When the bounce revert check runs
    Then the verdict is a breach report
    And no revert instruction is offered
