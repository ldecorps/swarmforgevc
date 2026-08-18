Feature: importing an already-QA-published tip is not a non-QA landing

  # BL-925 (deterministic-transit-assist). check_pipeline_code_on_main.sh
  # refuses any commit on `main` whose staged diff touches a QA-exclusive path
  # unless SWARMFORGE_ROLE=QA. It asks nothing about where that content came
  # from, so completing a merge of an origin/main QA already published is
  # refused exactly like fresh non-QA authorship. BL-891's reconcile sweep
  # treats the non-zero merge as failure, aborts, and logs a conflict — so the
  # join never completes while the checkout is ahead-and-behind, which is its
  # steady state.
  #
  # The boundary this pins is CONTENT PROVENANCE, not merge-in-progress: being
  # mid-merge is never on its own enough, or a writer could stage fresh
  # pipeline edits on top of a legitimate merge and ride through.
  #
  # Step handlers: specs/pipeline/steps/bl925ReconcileMergeOfPublishedTipSteps.js,
  # driving the guard and the sweep against fixture repos. The <content> column
  # is validated against explicit KNOWN_VALUES, never passed through.

  Background:
    Given a master checkout on `main`, ahead with bookkeeping commits and behind an `origin/main` that QA published

  # BL-925 provenance-decides-the-guard-01
  Scenario Outline: pipeline content is allowed onto main only when it comes from a published tip
    Given a writer that is not QA staging pipeline-code content that is <content>
    When the commit-time guard runs
    Then the commit is <outcome>

    Examples:
      | content                                        | outcome  |
      | taken unchanged from the QA-published parent   | allowed  |
      | newly authored in this checkout                | refused  |
      | edited on top of the merge of that parent      | refused  |

  # BL-925 both-hooks-agree-02
  Scenario Outline: the merge completes whichever hook fires
    Given the merge of the QA-published tip is completed by <command>
    When the guard runs from the hook that command fires
    Then that hook does not refuse the merge

    Examples:
      | command                  |
      | git merge --no-edit      |
      | git commit --no-edit     |

  # BL-925 real-conflict-still-aborts-03
  Scenario: a real conflict still aborts and leaves no half-finished merge
    Given the incoming QA-published tip genuinely conflicts with a local bookkeeping commit
    When the reconcile sweep attempts the merge
    Then the sweep aborts the merge and reports a conflict
    And the checkout is left on a clean `main` with no merge in progress

  # BL-925 sweep-completes-the-join-04
  Scenario: the reconcile sweep completes the join it previously could not
    Given the sweep has aborted this same clean merge on a previous tick
    When the sweep runs again after the guard change
    Then the merge commit is created and `main` contains the published tip
    And no tick reports a conflict for that merge

  # BL-925 unpublished-tip-is-not-waved-through-05
  Scenario: a merge parent QA has not published is refused
    Given an incoming commit touching pipeline code that is not an ancestor of the QA branch
    When a non-QA writer completes a merge of it on `main`
    Then the commit is refused naming the offending pipeline paths
