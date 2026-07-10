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
  # grows as each slice lands. Currently built: slice 1 = discovery (below).
  # Slices 2-4's Gherkin is parked in the companion
  # BL-233-recruiter-model-scout-role-fit.slices-2-4.feature.draft and is promoted
  # into this file when its slice is implemented.

  Background:
    Given the recruiter runs out-of-band, reusing the swarm-compliance battery and the provider abstraction, without modifying live swarm config

  # BL-233 discover-candidates-01
  Scenario: discovery lists candidate model plans with cost and a signup path
    Given the recruiter searches for free or cheap model plans
    When discovery completes
    Then it reports each candidate's model, provider, plan cost, and signup path
