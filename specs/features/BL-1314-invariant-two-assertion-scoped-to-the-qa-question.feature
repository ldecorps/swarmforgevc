Feature: The invariant-2 assertion fires on the QA question, not on ancestry in general

  BL-925's invariant 2 is "there is one definition of QA-approved tip in the
  repo; a second predicate that answers the same question differently is the
  defect". Its standing pin lives in
  swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh as a pair of
  greps: one over check_pipeline_code_on_main.sh, one over handoffd.bb.

  The bash half is scoped to the question - it greps for an inline ancestry
  call mentioning swarmforge-QA. The Babashka half is not: it greps handoffd.bb
  for any "merge-base" "--is-ancestor" at all, whatever pair of refs the call
  is about. That was equivalent on 2026-08-18, when handoffd.bb had exactly one
  such call and it was the QA one. It stopped being equivalent when BL-1130 and
  BL-668 added ancestry helpers asking entirely different questions, and the
  assertion has been false since. Nobody saw it: BL-1252's fixture rot had this
  test aborting at case 01, so the assertion was never reached.

  The invariant itself is intact throughout. handoffd.bb answers "is this a
  QA-approved tip" in exactly one place, by shelling to is_qa_ancestor.sh -
  the same script the bash guard calls.

  Background:
    Given the invariant-2 assertion in "swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh"
    And the shared QA-ancestry definition "swarmforge/scripts/is_qa_ancestor.sh"

  # BL-1314 invariant-two-scoped-to-the-qa-question-01
  Scenario Outline: An ancestry call about a pair of refs other than swarmforge-QA is not a violation
    Given "handoffd.bb" reaches the QA-approved-tip question through "is_qa_ancestor.sh"
    And handoffd.bb also defines "<helper>", which asks <question>
    When the invariant-2 assertion runs
    Then the assertion passes

    Examples:
      | helper                          | question                                                    |
      | master-main-origin-is-ancestor? | whether origin/main is an ancestor of HEAD                  |
      | git-is-ancestor?                | whether a role branch can fast-forward to the landed commit |

  # BL-1314 invariant-two-scoped-to-the-qa-question-02
  Scenario Outline: A second inline answer to the QA question is still a violation
    Given "<file>" reaches the QA-approved-tip question through "is_qa_ancestor.sh"
    And "<file>" also runs its own inline ancestry call against "swarmforge-QA"
    When the invariant-2 assertion runs
    Then the assertion fails
    And the failure names "<file>"

    Examples:
      | file                           |
      | handoffd.bb                    |
      | check_pipeline_code_on_main.sh |

  # BL-1314 invariant-two-scoped-to-the-qa-question-03
  Scenario: Dropping the shared definition is still a violation
    Given "handoffd.bb" no longer calls "is_qa_ancestor.sh" at all
    When the invariant-2 assertion runs
    Then the assertion fails
    And the failure names "handoffd.bb"

  # BL-1314 invariant-two-scoped-to-the-qa-question-04
  Scenario: The assertion passes against the live tree
    Given handoffd.bb and check_pipeline_code_on_main.sh exactly as they stand on main
    When the invariant-2 assertion runs
    Then the assertion passes
