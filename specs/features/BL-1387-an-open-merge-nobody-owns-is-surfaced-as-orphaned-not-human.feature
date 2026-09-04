# mutation-stamp: sha256=87fb5335baaf08e15f17951edea79d499f890e6c2f786e0ac00f5fddc6ca689f
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-04T11:24:04.513268242Z","feature_name":"BL-1387 An open merge nobody owns is surfaced as orphaned, not as a human's","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1387-an-open-merge-nobody-owns-is-surfaced-as-orphaned-not-human.feature","background_hash":"c4f6e9fa9c0e4da20eaebc48d5dc28f945734508738db6be0b045712583f1ac4","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a positive owner signal keeps the human-merge-in-progress reading","scenario_hash":"72447c681868b2e44b1a6a1c630a2a6ca341cc852bc5ea9602ad4432c5450a4d","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-04T11:24:04.513268242Z"},{"index":3,"name":"the orphaned surface states whether the index carries the incoming side","scenario_hash":"a2c66f77404a70943aa62e9515199691358096354c3e8f9b233a014142f1a960","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-04T11:24:04.513268242Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1387 An open merge nobody owns is surfaced as orphaned, not as a human's

  The reconcile sweep reads an open MERGE_HEAD on the shared main checkout
  as a human mid-merge, from presence alone, and every role sharing that
  checkout then holds for a human who may not exist. When the merge was
  left behind - by a failed abort, a killed pane, an interrupted index
  write - the index can carry none of the incoming side while showing no
  unmerged paths, and concluding it silently reverts the origin side. This
  feature is that an open merge is classified by ownership and liveness,
  that an orphan is named an orphan and escalated at once with the one fact
  a clearer needs, and that nothing is aborted by this classification. A
  merge the daemon can prove it started is the daemon's own, and what
  happens to it is BL-1386's contract, not this one's.

  Background:
    Given a fixture checkout with an open MERGE_HEAD created outside the sweep

  # BL-1387 an-unowned-merge-is-orphaned-01
  Scenario: with no owner signal the merge is surfaced as orphaned on the first tick
    Given no git process runs on the checkout
    And no index lock is present
    When one sweep tick runs
    Then the surfaced reason is orphaned-merge naming the MERGE_HEAD sha
    And the deadlock record reads reason orphaned-merge
    And the sync status CLI reports reason orphaned-merge
    And the escalation fires on that tick

  # BL-1387 an-owner-signal-keeps-todays-reading-02
  # Row "an ownership record naming the MERGE_HEAD sha" RETIRED 2026-09-04 (never reworded):
  # an owned merge is the daemon's own and BL-1386 aborts it - it is never a human's. See 06.
  Scenario Outline: a positive owner signal keeps the human-merge-in-progress reading
    Given <owner signal>
    When one sweep tick runs
    Then the surfaced reason is human-merge-in-progress
    And the escalation does not fire early

    Examples:
      | owner signal                                   |
      | a live git process whose cwd is the checkout   |
      | an index lock younger than the freshness window |

  # BL-1387 a-stale-lock-is-not-an-owner-03
  Scenario: an index lock older than the freshness window is not an owner
    Given an index lock older than the freshness window
    And no git process runs on the checkout
    When one sweep tick runs
    Then the surfaced reason is orphaned-merge naming the MERGE_HEAD sha

  # BL-1387 the-surface-says-whether-the-index-is-poisoned-04
  Scenario Outline: the orphaned surface states whether the index carries the incoming side
    Given no git process runs on the checkout
    And no index lock is present
    And the index <index state> the paths of HEAD..MERGE_HEAD
    And the index shows no unmerged paths
    When one sweep tick runs
    Then the surfaced text says the index <wording> the incoming side

    Examples:
      | index state      | wording        |
      | carries none of  | carries none of |
      | carries          | carries         |

  # BL-1387 classification-aborts-nothing-05
  Scenario: classifying an orphan never aborts it
    Given no git process runs on the checkout
    And no index lock is present
    When one sweep tick runs
    Then MERGE_HEAD is still present after the tick
    And the index is byte-identical to before the tick

  # BL-1387 an-owned-merge-is-the-daemons-not-a-humans-06
  Scenario: an ownership record naming the MERGE_HEAD sha classifies the merge as the daemon's own
    Given an ownership record naming the MERGE_HEAD sha
    When one sweep tick runs
    Then the open merge is classified as the daemon's own
    And the surfaced reason is neither human-merge-in-progress nor orphaned-merge
    And the escalation does not fire early
