Feature: push-sweep caches its refusal and gathers the ahead range once
  A refusing push-sweep re-derives the same verdict from scratch every heavy
  cycle: nothing is keyed on the tip plus the ahead-SHA set, and the QA gate and
  the noop-merge gate each walk the ahead range independently. The verdict is
  correct and must stay byte-identical; only the cost changes.

  The cache replays a verdict a full enumeration already produced for the same
  input. It never infers one — that was BL-952's removed fast path, and
  restoring it lets a bounced commit publish under an approved tip.

  Background:
    Given local main is ahead of origin/main by 5 commits

  # BL-1085 push-sweep-caches-its-refusal-and-gathers-once-01
  Scenario: The first refusing tick enumerates and records its verdict
    Given one ahead commit is not QA-approved
    When a push-sweep tick runs
    Then the ahead range is enumerated
    And the sweep refuses with "non-qa-ancestor"

  # BL-1085 push-sweep-caches-its-refusal-and-gathers-once-02
  Scenario: A tick with unchanged inputs replays the verdict without enumerating
    Given a push-sweep tick has already refused with "non-qa-ancestor"
    When a push-sweep tick runs
    Then the ahead range is not enumerated
    And the sweep refuses with "non-qa-ancestor"

  # BL-1085 push-sweep-caches-its-refusal-and-gathers-once-03
  Scenario Outline: Any change to the cache key forces a fresh enumeration
    Given a push-sweep tick has already refused with "non-qa-ancestor"
    And <change>
    When a push-sweep tick runs
    Then the ahead range is enumerated

    Examples:
      | change                                                    |
      | a new commit is added to local main                       |
      | origin/main advances so the ahead set shrinks              |
      | the ahead set is reordered without changing its length     |

  # BL-1085 push-sweep-caches-its-refusal-and-gathers-once-04
  Scenario: An incomplete gather is never cached
    Given the previous tick's gather did not complete
    When a push-sweep tick runs
    Then the ahead range is enumerated

  # BL-1085 push-sweep-caches-its-refusal-and-gathers-once-05
  Scenario: A gathering tick walks the ahead range exactly once for both gates
    When a push-sweep tick runs
    Then the ahead range is enumerated exactly once
    And the noop-merge gate and the QA gate both decide from that one fact set

  # BL-1085 push-sweep-caches-its-refusal-and-gathers-once-06
  Scenario Outline: The cached verdict equals the verdict a full re-gather gives
    Given the ahead range contains <ahead_shape>
    When a push-sweep tick runs with the cache enabled
    And a push-sweep tick runs with the cache disabled
    Then both ticks reach the same verdict

    Examples:
      | ahead_shape                                     |
      | a non-QA-approved commit                        |
      | a bounced parcel riding under an approved tip   |
      | a noop landing merge                            |
      | only QA-approved commits                        |
