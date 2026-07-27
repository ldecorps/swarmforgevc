Feature: Every failure class the role prompts instruct is recordable

  Background:
    Given a bounce log containing one record with failure class "behavior" bounced by "architect"

  # BL-688 recordable-spec-failure-classes-01
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
