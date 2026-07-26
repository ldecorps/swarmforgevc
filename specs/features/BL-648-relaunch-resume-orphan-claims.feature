# mutation-stamp: sha256=8583ea5370c7fbebc65522f4aca6800f5f6e93ce33b51dea2b34d8e72b098154
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-26T21:32:51.592983917Z","feature_name":"Relaunch resumes the recorded role and reclaims orphaned claims","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-648-relaunch-resume-orphan-claims.feature","background_hash":"0a4456ad255650cd4e7d8bef1d011b008fb00cbf798b04e2ac725acf86694e6f","implementation_hash":"unknown","scenarios":[{"index":1,"name":"A missing or blank recorded role boots the resident at home","scenario_hash":"8a12ee81a5dedf3fe0e17a6e480a8e989267b24dbdaf3137fb0ddf65eb8b423b","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-26T21:32:51.592983917Z"}]}
# acceptance-mutation-manifest-end

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
