Feature: A git handoff whose commit no longer resolves is quarantined at dequeue instead of handed to a role

  Background:
    Given a parcel has been delivered to a role's inbox

  # BL-610 unresolvable-commit-quarantined-at-dequeue-01
  Scenario: A git handoff whose commit no longer resolves is quarantined rather than dequeued
    Given the parcel is a git handoff whose commit no longer resolves to a git object
    When the role receives work
    Then the parcel is quarantined to the dead letter path
    And the parcel is not handed to the role as a task
    And the quarantine is announced with an unresolvable commit diagnostic

  # BL-610 unresolvable-commit-quarantined-at-dequeue-02
  Scenario: The quarantine record carries what is needed to investigate the gap
    Given the parcel is a git handoff whose commit no longer resolves to a git object
    When the role receives work
    Then the quarantine record states the commit, the task, the sending role, when it was sent, and when it was dequeued

  # BL-610 unresolvable-commit-quarantined-at-dequeue-03
  Scenario: A git handoff whose commit still resolves is dequeued unchanged
    Given the parcel is a git handoff whose commit still resolves to a git object
    When the role receives work
    Then the parcel is handed to the role as a task
    And the parcel is not quarantined

  # BL-610 unresolvable-commit-quarantined-at-dequeue-04
  Scenario Outline: A <parcel type> parcel carries no commit and is never commit checked
    Given the parcel is a <parcel type>
    When the role receives work
    Then the parcel is handed to the role as a task
    And no git object lookup is performed for that parcel

    Examples:
      | parcel type |
      | note        |
      | awake       |

  # BL-610 unresolvable-commit-quarantined-at-dequeue-05
  Scenario: The existing structural corruption check still fires on its own
    Given the parcel is structurally corrupt
    When the role receives work
    Then the parcel is quarantined to the dead letter path
    And the quarantine is announced with a corrupt handoff diagnostic

  # BL-610 unresolvable-commit-quarantined-at-dequeue-06
  Scenario: Send time validation reports a commit that matches nothing as matching nothing
    Given a draft git handoff whose commit matches no git object
    When the draft is sent
    Then the send is rejected
    And the rejection states that the commit matched no object
