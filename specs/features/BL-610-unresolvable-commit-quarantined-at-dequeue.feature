# mutation-stamp: sha256=5938f697bfdf0d18b99bde9b3de0c211a36ffc92a9972055f326df4c4a62bc83
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-24T16:09:06.249152679Z","feature_name":"A git handoff whose commit no longer resolves is quarantined at dequeue instead of handed to a role","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-610-unresolvable-commit-quarantined-at-dequeue.feature","background_hash":"f64d411b14c6a66f71893dc8eebc90135f4273a1515fdee035b8837d81b8e822","implementation_hash":"unknown","scenarios":[{"index":3,"name":"A <parcel type> parcel carries no commit and is never commit checked","scenario_hash":"c1cec7a96505907bb44affdc7ce37762c66efe96278a46669e67ac982b6a78d0","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-24T16:09:06.249152679Z"}]}
# acceptance-mutation-manifest-end

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
