# mutation-stamp: sha256=574636154ace8d44597535510eb427e6c3f010f8395025b081bf261740f52ca5
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-10T13:33:08.919120759Z","feature_name":"a recruiter scouts cheap/free model plans and ranks best-value model per swarm role","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-233-recruiter-model-scout-role-fit.feature","background_hash":"0fa0dc9a5643003fef2663df390f14f4ee3e707caa7c37ffde25a3e2a4ccba1d","implementation_hash":"unknown","scenarios":[{"index":2,"name":"a signup wall escalates to a human instead of proceeding","scenario_hash":"20ac7879bcd3bc0c278ead3e374270cbfbe5ae60192774f87fc62e4df5c1a837","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-10T13:33:08.919120759Z"}]}
# acceptance-mutation-manifest-end

Feature: a recruiter scouts cheap/free model plans and ranks best-value model per swarm role

  # Purpose (operator 2026-07-10): an out-of-band "recruiter" that hunts the
  # internet for free/cheap model plans, acquires access, puts each candidate
  # through the swarm-compliance battery (BL-231), and ranks the compliant ones
  # per role by best value (capability per cost) so the swarm can adopt cheaper
  # models — knowing which model is best for which role. The recruiter RECOMMENDS
  # a swarmforge.conf change; a human applies it. It never mutates live config.
  #
  # SLICED DELIVERY (see BL-233): this ticket ships in slices. The acceptance
  # runner (specs/pipeline/runtime.js) THROWS on any scenario lacking a step
  # handler, so this file carries ONLY the scenarios for slices already BUILT and
  # grows as each slice lands. Currently built: slice 1 = discovery, slice 2 =
  # acquire access, slice 3 = qualify via battery (below). Slice 4's Gherkin is
  # parked in the companion
  # BL-233-recruiter-model-scout-role-fit.slice-4.feature.draft and is promoted
  # into this file when its slice is implemented.

  Background:
    Given the recruiter runs out-of-band, reusing the swarm-compliance battery and the provider abstraction, without modifying live swarm config

  # BL-233 discover-candidates-01
  Scenario: discovery lists candidate model plans with cost and a signup path
    Given the recruiter searches for free or cheap model plans
    When discovery completes
    Then it reports each candidate's model, provider, plan cost, and signup path

  # BL-233 auto-acquire-free-02
  Scenario: a free plan is auto-signed-up and its key stored in the host secret store
    Given a discovered candidate whose plan is free and permits automated signup
    When the recruiter acquires access
    Then it obtains an API key and stores it in the host secret store
    And the key is never written to the working tree or any commit

  # BL-233 acquire-wall-escalates-03
  Scenario Outline: a signup wall escalates to a human instead of proceeding
    Given a discovered candidate whose signup requires "<wall>"
    When the recruiter attempts to acquire access
    Then it escalates to a human for that candidate
    And no API key is fabricated and nothing is committed

    Examples:
      | wall                  |
      | payment details       |
      | a captcha             |
      | manual ToS acceptance |

  # BL-233 qualify-via-battery-04
  Scenario: each acquired candidate is scored by the swarm-compliance battery
    Given a candidate whose access has been acquired
    When the recruiter qualifies it
    Then it runs the swarm-compliance battery and records the candidate's per-role scorecard
