Feature: master-main reconcile predicts conflicts from git's verdict, not from prose
  handoffd's master-main reconcile decides whether to absorb a two-way
  divergence with a real merge or to reset local main onto origin/main. That
  decision turns on one prediction: would the merge conflict?

  Today the prediction is a case-insensitive text search for "changed in
  both", "CONFLICT" or "added in both" over the OUTPUT of the legacy
  three-argument `git merge-tree`, which is a unified diff of the merged
  content. Any ticket, evidence file or prompt whose prose contains the word
  "conflict" therefore reads as a conflict. On 2026-08-28 at 06:11:59Z that
  fired on five prose lines - one of which literally reads "No conflicts." -
  and nine committed commits were made unreachable by a reset for a merge
  `git merge-tree --write-tree` resolves cleanly.

  A prediction must come from git's own verdict about the merge, and an
  answer git could not give must never be the thing that authorises a reset.

  Background:
    Given local main has diverged two ways from origin/main
    And the divergence carries local commits that origin does not have

  # BL-1236 reconcile-conflict-prediction-01
  Scenario Outline: The prediction follows git's verdict, not the merged text
    Given the merged files <content> the word "CONFLICT" in their own text
    And git reports the merge as <verdict>
    When the reconcile sweep predicts whether the merge would conflict
    Then the prediction is <prediction>

    Examples:
      | content        | verdict    | prediction  |
      | contain        | clean      | no conflict |
      | do not contain | clean      | no conflict |
      | contain        | conflicted | conflict    |
      | do not contain | conflicted | conflict    |

  # BL-1236 reconcile-conflict-prediction-02
  Scenario: A cleanly mergeable divergence is absorbed, never reset away
    Given git reports the merge as clean
    When the reconcile sweep runs
    Then local main contains origin/main
    And every local commit that preceded the sweep is still reachable from HEAD

  # BL-1236 reconcile-conflict-prediction-03
  Scenario: An unavailable verdict never authorises a reset
    Given git cannot produce a merge verdict for the divergence
    When the reconcile sweep runs
    Then no reset is performed
    And local main is left exactly as it was found
    And the sweep records that the verdict was unavailable

  # BL-1236 reconcile-conflict-prediction-04
  Scenario: A genuine conflict still reaches the existing recovery path
    Given git reports the merge as conflicted
    When the reconcile sweep runs
    Then the reconcile sweep takes its existing conflict recovery path
