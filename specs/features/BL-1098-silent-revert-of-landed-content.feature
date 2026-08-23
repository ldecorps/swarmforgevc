Feature: Content that no commit authored never reaches origin

  BL-855 pinned the merge that takes NOTHING. This pins its harder sibling:
  the merge that takes MOST of what it merges and quietly puts a handful of
  paths back to a superseded state. BL-973's landed fix was reverted that way
  three times in twenty-four hours and restored by hand twice inside a single
  landing, because the only defence was a reviewer's eye. The signature is
  always the same: for those paths the tip holds a blob that some EARLIER
  commit authored, while a LATER commit authored different content and no
  commit anywhere records the change back. `git log -- <path>` shows only
  merges, so the revert has no author, no message and no reviewer.

  These scenarios pin the missing question - is this path's content the work
  its newest authoring commit actually wrote - and, just as importantly, pin
  the two shapes that must stay silent, because a gate that cries wolf gets
  switched off. Both are measured over the last 60 merges on main: every one
  of the 27 pipeline stage merge-ups was clean, while a naive
  "a one-sided change was discarded" predicate would have flagged 22 of the
  60, including the deliberate reconcile that was resolving this very defect.

  Background:
    Given the push sweep is inspecting the commits on main that have not reached origin
    And the inspection covers the paths that merges in that range touched

  # BL-1098 silent-revert-of-landed-content-01
  Scenario Outline: The verdict turns on whether a commit authored the content the tip holds
    Given a path whose newest authoring commit is a non-merge commit
    And the tip holds <tip_content> for that path
    When the push sweep decides whether to push
    Then the push is <verdict>

    Examples:
      | tip_content                                    | verdict |
      | the content that newest authoring commit wrote | allowed |
      | a superseded blob an earlier commit authored   | refused |
      | no file at all, with no delete commit recorded | refused |

  # BL-1098 silent-revert-of-landed-content-02
  Scenario: The refusal hands back what a restore needs, not a bare status
    Given a path whose tip content is a superseded blob an earlier commit authored
    When the push sweep refuses to push
    Then the refusal names the path
    And the refusal names the commit that authored the content the tip is missing
    And the refusal names the merge commit at which the path stopped matching that commit

  # BL-1098 silent-revert-of-landed-content-03
  Scenario: Discarding a superseded blob is a correct reconcile, not a revert
    Given a merge that discarded paths its second parent had changed one-sidedly
    And the discarded content for every one of those paths is a superseded blob
    And the merge result for every one of those paths matches its newest authoring commit
    When the push sweep decides whether to push
    Then the push is allowed

  # BL-1098 silent-revert-of-landed-content-04
  Scenario: The clean forward chain is never flagged
    Given a stage merge-up in which every touched path matches its newest authoring commit
    When the push sweep decides whether to push
    Then the push is allowed

  # BL-1098 silent-revert-of-landed-content-05
  Scenario: A dirty working tree cannot change the verdict
    Given a path whose tip content is a superseded blob an earlier commit authored
    And the working tree has uncommitted changes to that same path
    When the push sweep decides whether to push
    Then the push is refused
