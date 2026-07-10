Feature: a recruiter scouts cheap/free model plans and ranks best-value model per swarm role

  # Purpose (operator 2026-07-10): an out-of-band "recruiter" that hunts the
  # internet for free/cheap model plans, acquires access, puts each candidate
  # through the swarm-compliance battery (BL-231), and ranks the compliant ones
  # per role by best value (capability per cost) so the swarm can adopt cheaper
  # models — knowing which model is best for which role. The recruiter RECOMMENDS
  # a swarmforge.conf change; a human applies it. It never mutates live config.
  # Reuses BL-231's battery and the landed provider abstraction (BL-206-209),
  # which is what now lets the battery drive a non-Claude candidate.

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

  # BL-233 best-value-ranking-05
  Scenario: each role gets a best-value leaderboard over compliant candidates
    Given several candidates scored by the battery for a role
    When the recruiter ranks them for that role
    Then only battery-compliant candidates are ranked
    And they are ordered by capability weighted against plan cost, cheapest breaking ties
    And the current model for that role appears as the reference baseline
    And a best-value model is recommended for that role

  # BL-233 recommend-not-adopt-06
  Scenario: the recruiter recommends a config change but never applies it
    Given a best-value recommendation for a role
    When the recruiter emits its report
    Then the report includes a suggested swarmforge.conf --model change for that role
    And the recruiter does not modify swarmforge.conf or bounce the swarm
