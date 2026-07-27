# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-27T12:05:21.765623495Z","feature_name":"Every failure class the role prompts instruct is recordable","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-688-recordable-spec-failure-classes.feature","background_hash":"3d6ec796f401515448a0c7aa08ba55770fe32372b6a510ae614fd9baa19f02bf","implementation_hash":"unknown","scenarios":[{"index":2,"name":"The briefing bounce line counts a record of a widened class","scenario_hash":"9ae18f5da2a14c35573c0ab42e85e7488c25f596616009478d9defe9be66b4da","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-27T12:03:27.325241380Z"}]}
# acceptance-mutation-manifest-end

Feature: Every failure class the role prompts instruct is recordable

  Background:
    Given a bounce log containing one record with failure class "behavior" bounced by "architect"

  # BL-688 recordable-spec-failure-classes-01
  # Hardener note (BL-113 mutation pass, 2026-07-27): a case-mangle of the
  # <class> VALUE on each of the two "rejected" rows below (flaky -> flAky;
  # INVARIANT-UNENCODED -> INVARIANT-UNeNCODED) survives - an accepted
  # equivalent mutant per BL-234, not a coverage gap. isKnownFailureClass is a
  # plain closed-set Set.has() lookup (qaBounce.ts), so it treats every
  # non-member string identically; both rows exist specifically to prove the
  # reject path for a value outside the set (an arbitrary word, and a case
  # variant of a valid class), and mutating one rejected string into another
  # rejected string cannot change the "rejected"/"1" outcome - no assertion
  # here (or anywhere downstream - parseArgs/isKnownFailureClass are the only
  # consumers of the literal value) could ever differentiate them. All other
  # 21 mutants in this outline (the 7 "recorded" classes, both non-class
  # columns on every row) killed clean.
  Scenario Outline: The recorder accepts exactly the named failure classes
    When a bounce is recorded with failure class "<class>"
    Then the recorder answers "<outcome>"
    And the bounce log holds "<records>" records

    Examples:
      | class               | outcome  | records |
      | compile             | recorded | 2       |
      | unit                | recorded | 2       |
      | integration         | recorded | 2       |
      | acceptance          | recorded | 2       |
      | behavior            | recorded | 2       |
      | invariant-unencoded | recorded | 2       |
      | spec-gap            | recorded | 2       |
      | flaky               | rejected | 1       |
      | INVARIANT-UNENCODED | rejected | 1       |

  # BL-688 recordable-spec-failure-classes-02
  Scenario: A rejected class is a usage error that writes to neither durable store
    When a bounce is recorded with failure class "flaky"
    Then the recorder exits non-zero printing its usage
    And no bounce_history entry is merged onto the ticket

  # BL-688 recordable-spec-failure-classes-03
  Scenario Outline: The briefing bounce line counts a record of a widened class
    Given a bounce is recorded with failure class "<class>"
    When the briefing bounce line is printed
    Then it reports a total of "2" bounces

    Examples:
      | class               |
      | invariant-unencoded |
      | spec-gap            |

  # BL-688 recordable-spec-failure-classes-04
  Scenario: A record written before the widening still reads and tallies unchanged
    When the briefing bounce line is printed
    Then it reports a total of "1" bounces
    And it attributes "1" bounce to bouncing role "architect"

  # BL-688 recordable-spec-failure-classes-05
  Scenario: A sibling deferral may carry a widened class and suppresses only its own signature
    Given a sibling deferral for "BL-500" blocked by "BL-501" with failure class "spec-gap"
    When "BL-500" fails a check with failure class "unit"
    Then the disposition for "BL-500" is "bounce"

  # BL-688 recordable-spec-failure-classes-06
  Scenario: The class the architect prompt instructs for an unencoded invariant records end to end
    Given the architect prompt instructs failure class "invariant-unencoded"
    When a bounce is recorded with that instructed class
    Then the recorder answers "recorded"
    And the bounce log holds a record with failure class "invariant-unencoded"
