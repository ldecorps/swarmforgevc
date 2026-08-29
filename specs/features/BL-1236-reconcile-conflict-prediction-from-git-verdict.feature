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

  TWO entry points reach that one prediction, not one: the handoffd reconcile
  sweep and the post-hotfix merge CLI, which today each carry their own
  byte-identical copy of the same legacy call and both end at a reset. Fixing
  one and leaving the other is a half-fix that keeps the hazard live at the
  entry point an operator batch runs.

  A prediction must come from git's own verdict about the merge, and an
  answer git could not give must never be the thing that authorises a reset.

  Background:
    Given local main has diverged two ways from origin/main
    And the divergence carries local commits that origin does not have

  # IR-DRY: the checker flags "git reports the merge as <verdict>" against the
  # fixed "clean"/"conflicted" Givens below as near-duplicates. They are NOT
  # extracted to Background and NOT collapsed, deliberately: scenario 01
  # parameterises the verdict to pin the PREDICATE, scenarios 02/04 fix it to
  # pin the resulting SWEEP BEHAVIOUR, and scenario 03 asserts the case where
  # no verdict exists at all - which a shared Background Given would
  # contradict. The same holds for scenario 05's fixed "contain" Given against
  # scenario 01's <content> placeholder: 05 fixes content AND verdict in order
  # to vary the ENTRY POINT instead. Keeping the wording identical modulo the
  # placeholder is deliberate - one parameterised step handler serves both, and
  # rewording either one purely to quiet the checker would be the accidental
  # drift it exists to catch. Recorded so a reviewer does not re-litigate it.

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
  # RETIRE-WITH: whichever ticket reopens the genuine-conflict recovery path.
  # This scenario pins behaviour BL-1214 deliberately froze ("that path must
  # keep behaving exactly as it does today") and BL-1236's out_of_scope
  # deliberately preserves. It is a regression guard for THIS ticket, not a
  # permanent contract: it goes red the day someone legitimately teaches the
  # conflict path to attempt a merge. Whoever ships that retires this scenario
  # (retire, never reword - the successor's own scenarios are the coverage).
  Scenario: A genuine conflict still reaches the existing recovery path
    Given git reports the merge as conflicted
    When the reconcile sweep runs
    Then the reconcile sweep takes its existing conflict recovery path

  # BL-1236 reconcile-conflict-prediction-05
  Scenario Outline: Every reconcile entry point predicts from the same git verdict
    Given the merged files contain the word "CONFLICT" in their own text
    And git reports the merge as clean
    When <entry point> decides whether the merge would conflict
    Then the prediction is no conflict
    And no reset is performed

    Examples:
      | entry point                  |
      | the handoffd reconcile sweep |
      | the post-hotfix merge CLI    |
