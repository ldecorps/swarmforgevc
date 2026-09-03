Feature: A merge is charged only with the pipeline paths it introduced

  The Article 4.2 sweep asks, for each commit reachable from a main ref but
  not an ancestor of swarmforge-QA, which QA-exclusive paths that commit
  touched. For a merge it asks with `git diff-tree -m --first-parent`.

  `--first-parent` is a revision-traversal option and has no effect on
  `diff-tree` for a single named commit: with `-m`, diff-tree emits one diff
  section per parent, so the answer is the UNION of the diffs against every
  parent. A merge is therefore charged with content that only ever existed on
  a side branch and that the merge did not carry onto its first-parent line at
  all.

  Because `specs/pipeline/steps/index.js` is the registry every ticket
  appends to, that union is non-empty on essentially every merge-up, and the
  BL-962 exemption cannot rescue it: the exemption consults only the non-first
  parents, and the parent the merge result actually matches in this shape is
  the first one.

  The bar is to narrow what a merge is charged with WITHOUT going blind to a
  merge's own content, which is the failure BL-590 fixed: a plain `diff-tree`
  reports zero files for a merge. The comparison that answers both is the
  two-tree diff between the first parent and the merge.

  Background:
    Given the sweep is classifying a commit that is reachable from a main ref and is not an ancestor of swarmforge-QA

  # BL-1359 a-merge-is-charged-only-with-what-it-introduced-01
  Scenario: a merge that carried no pipeline content onto its branch is not reported
    Given a merge whose result for a QA-exclusive path is byte-identical to its first parent
    And a non-first parent whose version of that path differs
    When the sweep classifies the commit
    Then the commit is not reported for that path

  # BL-1359 a-merge-is-charged-only-with-what-it-introduced-02
  Scenario: a merge that did introduce pipeline content is still reported
    Given a merge whose result for a QA-exclusive path differs from its first parent
    And no QA-approved parent holds that path byte-identically
    When the sweep classifies the commit
    Then the commit is reported for that path

  # BL-1359 a-merge-is-charged-only-with-what-it-introduced-03
  Scenario: a QA-approved parent holding identical content still clears the path
    Given a merge whose result for a QA-exclusive path differs from its first parent
    And a QA-approved non-first parent holds that path byte-identically
    When the sweep classifies the commit
    Then the commit is not reported for that path

  # BL-1359 a-merge-is-charged-only-with-what-it-introduced-04
  Scenario Outline: a git call that cannot answer withholds the whole sweep
    Given a merge whose result for a QA-exclusive path differs from its first parent
    And the <call> cannot answer
    When the sweep classifies the commit
    Then the sweep reports that ancestry is unavailable
    And no offending commit is reported

    Examples:
      | call                 |
      | touched-path read    |
      | parent ancestry call |
      | parent content diff  |

  # BL-1359 a-merge-is-charged-only-with-what-it-introduced-05
  Scenario: a non-merge commit is charged exactly as before
    Given a non-merge commit that adds a QA-exclusive path
    When the sweep classifies the commit
    Then the commit is reported for that path
