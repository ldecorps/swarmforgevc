Feature: Relaunch resumes the recorded role and reclaims orphaned claims

  Background:
    Given a rotation-router pack launched with injected session-liveness, role-file, and inbox seams

  # BL-648 relaunch-resume-orphan-claims-01
  Scenario: Relaunch boots the resident as the recorded active role and its claim resumes
    Given "mono-router-active-role" records "QA" and QA's in_process holds a claimed parcel
    When the swarm relaunches
    Then the resident comes up as "QA"
    And the claimed parcel is still in QA's in_process and is resumed without re-delivery

  # BL-648 relaunch-resume-orphan-claims-02
  Scenario Outline: A missing or blank recorded role boots the resident at home
    Given "mono-router-active-role" is <state>
    When the swarm relaunches
    Then the resident comes up as the home role

    Examples:
      | state   |
      | missing |
      | blank   |

  # BL-648 relaunch-resume-orphan-claims-03
  Scenario: An unknown recorded role falls back to home loudly instead of crashing the launch
    Given "mono-router-active-role" records "not-a-role"
    When the swarm relaunches
    Then the resident comes up as the home role
    And the launch log carries a loud line naming the unreadable role record

  # BL-648 relaunch-resume-orphan-claims-04
  Scenario: A dead-owner claim in another role's in_process is re-delivered within one launch cycle
    Given role "cleaner" holds a claimed parcel in in_process and its owning session is "dead"
    When the swarm relaunches
    Then the parcel is back in role "cleaner" inbox new with its original priority
    And the launch or daemon log carries a loud reclaim line naming the parcel

  # BL-648 relaunch-resume-orphan-claims-05
  Scenario: A claim whose owning session is alive is untouched by the sweep
    Given role "cleaner" holds a claimed parcel in in_process and its owning session is "alive"
    When the orphan sweep runs
    Then the parcel remains claimed in role "cleaner" in_process and no copy exists in inbox new

  # BL-648 relaunch-resume-orphan-claims-06
  Scenario: On a non-rotation pack the role record is ignored but the orphan sweep still runs
    Given a non-rotation pack where "mono-router-active-role" records "QA"
    And role "architect" holds a claimed parcel in in_process and its owning session is "dead"
    When the swarm relaunches
    Then role sessions boot exactly as today ignoring the role record
    And the parcel is back in role "architect" inbox new with its original priority
