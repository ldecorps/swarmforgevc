Feature: BL-962 on-main sweep adjudicates reconciliation merges against QA-approved parents

  The babysitter pipeline-code-on-main gatherer (BL-631,
  gather-pipeline-code-on-main in babysitter_check.bb) diffs a merge commit
  with -m --first-parent only, so an operator reconciliation merge of
  QA-landed work is charged with everything its QA-side parent brought in
  and raises a false CRIT. A merge's QA-exclusive path must be exempted
  when a QA-approved parent holds byte-identical content for it - the same
  rule BL-925 already applies at commit time - while everything else keeps
  firing exactly as before, and any adjudication failure fails the sweep
  closed.

  Background:
    Given a scratch git repository with branches "main" and "swarmforge-QA"
    And the QA-exclusive path set is stubbed to contain "extension/src/"

  # BL-962 on-main-merge-adjudication-01
  Scenario: a reconciliation merge of QA-landed pipeline code is not reported
    Given a commit on "swarmforge-QA" adds "extension/src/landed.ts" and is merged into "main" by QA
    And "main" gains a reconciliation merge whose second parent is that QA-approved tip
    And the merge result for "extension/src/landed.ts" is byte-identical to that parent's version
    When the sweep gathers pipeline-code-on-main findings
    Then the reconciliation merge commit is absent from the offending commits
    And ancestry-unavailable is false

  # BL-962 on-main-merge-adjudication-02
  Scenario: a merge carrying its own edit to a QA-exclusive path is still reported, naming only that path
    Given a commit on "swarmforge-QA" adds "extension/src/landed.ts" and is merged into "main" by QA
    And "main" gains a reconciliation merge whose second parent is that QA-approved tip
    And the merge result additionally changes "extension/src/rider.ts" to content held by no parent
    When the sweep gathers pipeline-code-on-main findings
    Then the merge commit is reported with the offending path "extension/src/rider.ts"
    And "extension/src/landed.ts" is not among its offending paths

  # BL-962 on-main-merge-adjudication-03
  Scenario: content matching a parent that is not QA-approved never clears a merge
    Given a merge on "main" whose second parent is a branch tip that is not an ancestor of "swarmforge-QA"
    And the merge result for "extension/src/side.ts" is byte-identical to that second parent's version
    When the sweep gathers pipeline-code-on-main findings
    Then the merge commit is reported with the offending path "extension/src/side.ts"

  # BL-962 on-main-merge-adjudication-04
  Scenario: a plain non-merge commit touching a QA-exclusive path on main is still reported
    Given a non-merge commit on "main" that adds "extension/src/direct.ts" and is not an ancestor of "swarmforge-QA"
    When the sweep gathers pipeline-code-on-main findings
    Then that commit is reported with the offending path "extension/src/direct.ts"

  # BL-962 on-main-merge-adjudication-05
  Scenario: a failure during merge-parent adjudication fails the sweep closed
    Given a commit on "swarmforge-QA" adds "extension/src/landed.ts" and is merged into "main" by QA
    And "main" gains a reconciliation merge whose second parent is that QA-approved tip
    And the ancestry predicate fails with an error during the adjudication of that merge
    When the sweep gathers pipeline-code-on-main findings
    Then the gather reports ancestry-unavailable
    And no offending commits are reported alongside it
