Feature: A parcel QA bounced never reads as QA-approved

  Approval is inferred from one predicate - is the commit an ancestor of the
  swarmforge-QA ref. QA merges a parcel into that ref to REVIEW it, so a
  parcel QA then bounces stays reachable from it and keeps reading as
  approved. The only thing that removes it is a manual revert, so the gate
  silently inherits whether a human remembered that step, and fails open
  when they did not.

  Background:
    Given a repository whose QA ref holds a parcel QA has already bounced

  # BL-952 bounced-parcel-never-approved-01
  Scenario Outline: approval is decided by verdict, not by reachability
    Given a parcel whose QA verdict is <verdict>
    When the publish gate is asked whether that parcel's commit is QA-approved
    Then it answers <approved>

    Examples:
      | verdict            | approved |
      | approved           | yes      |
      | bounced            | no       |
      | bounced then fixed | no       |
      | never reviewed     | no       |

  # BL-952 bounced-parcel-never-approved-02
  Scenario: a bounced parcel left in the QA ref does not ride out on the next landing
    Given a bounced parcel that was never reverted out of the QA ref
    And a second, genuinely approved parcel ready to publish
    When the publish gate runs over the range about to be pushed
    Then it refuses the push
    And it names the bounced parcel as the reason

  # BL-952 bounced-parcel-never-approved-03
  Scenario: publishing an approved parcel alone still succeeds
    Given every parcel in the range about to be pushed is QA-approved
    When the publish gate runs over the range about to be pushed
    Then it allows the push

  # BL-952 bounced-parcel-never-approved-04
  Scenario Outline: an undeterminable verdict fails closed
    Given a parcel whose QA verdict cannot be determined because <cause>
    When the publish gate is asked whether that parcel's commit is QA-approved
    Then it refuses the push
    And it reports the cause rather than a bare refusal

    Examples:
      | cause                         |
      | the commit does not resolve   |
      | the verdict record is missing |
      | the verdict record is corrupt |

  # BL-952 bounced-parcel-never-approved-05
  Scenario: every consumer of the predicate gets the same answer
    Given a parcel whose QA verdict is bounced
    When each consumer of the shared approval predicate is asked about it
    Then every consumer answers that it is not approved
