Feature: the swarm gates build on an agreed onboarding contract in the target repo

  # Operator direction 2026-07-10 (via coordinator, INTAKE-onboarding-contract-
  # agreement.md): plugging the swarm into a new project needs the target repo to
  # AGREE to a contract firming up what the swarm will do BEFORE build starts. This
  # is a PROJECT-LEVEL scope agreement sitting ABOVE the existing per-ticket
  # human_approval gate (it firms up the overall mandate; per-ticket approval still
  # gates each feature) — it does not replace or duplicate human_approval.
  #
  # SLICE 1 (this feature): the contract artifact + agree marker + the build-start
  # gate. Operator decisions (2026-07-10): HYBRID artifact — a structured
  # .swarmforge/contract.yaml is the source of truth the gate parses, and a legible
  # CONTRACT.md view is generated/committed alongside for the target's humans;
  # consent is a HAND-FLIPPED marker (agreement: pending -> agreed) committed to the
  # target, reusing the human_approval field PATTERN (not its code); scope change is
  # handled by MANUAL re-open (operator flips back to pending, re-agrees). The
  # auto-drafted scope proposal (PROPOSE) is a LATER slice — parked in
  # BL-262-onboarding-contract-agreement.slice-2-proposal.feature.draft (BL-233).
  #
  # Verified live layer: the contract scaffolds via targetBootstrap.ts
  # (buildTargetBootstrapFiles / planTargetBootstrapFiles are already PURE); the gate
  # sits at the coordinator's paused->active promotion (where build dispatch begins).
  # The gate decision is a PURE function on injected contract state — never a live
  # swarm/timer/real-repo dependency. BL-247: the coordinator.prompt rule enforcing
  # the gate lands WITH the mechanism through the pipeline, never hot-edited ahead.

  Background:
    Given a build-start gate that reads the target repo's onboarding contract

  # BL-262 gate-requires-agreement-01
  Scenario Outline: the swarm starts build work only when the contract is agreed
    Given the target repo's onboarding contract is "<state>"
    When the swarm evaluates whether it may start dispatching build work
    Then the build-start gate "<decision>"

    Examples:
      | state     | decision |
      | agreed    | allows   |
      | pending   | holds    |
      | missing   | holds    |
      | malformed | holds    |

  # BL-262 gate-hold-explains-02
  Scenario: a held gate names the unagreed contract as the reason
    Given the target repo's onboarding contract is "pending"
    When the swarm evaluates whether it may start dispatching build work
    Then the gate holds and reports that the onboarding contract is awaiting agreement

  # BL-262 scaffold-on-init-03
  Scenario: initializing a target scaffolds a pending contract and a legible view
    Given a freshly initialized target repo
    When the swarm bootstraps the target's SwarmForge files
    Then the target gains a contract source marked as awaiting agreement
    And a legible contract view is committed alongside the source

  # BL-262 reopen-reholds-04
  Scenario: reopening the contract for a scope change re-holds the gate
    Given the target repo's onboarding contract is "agreed"
    When the operator flips the contract back to awaiting agreement
    Then the build-start gate "holds"

  # BL-262 legible-view-matches-source-05
  Scenario: the legible contract view reflects the contract source of truth
    Given a contract source stating the swarm's scope and agreement state
    When the legible contract view is generated
    Then it shows the same scope and agreement state as the source
