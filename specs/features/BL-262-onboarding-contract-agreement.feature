Feature: the swarm surveys a new target repo and proposes an onboarding contract, gated on agreement

  # Operator RE-SCOPE (2026-07-10, via coordinator): the earlier design had a
  # HAND-AUTHORED contract the operator hand-flipped to "agreed". The operator now
  # wants the swarm to SURVEY the target repo and PROPOSE a contract that is then
  # NEGOTIATED to agreement, before any build work dispatches. Operator decisions:
  #   - NEGOTIATE = iterative loop (propose -> request changes -> revise -> re-propose,
  #     until agreed). The iteration itself is SLICE 2 (parked draft); this slice 1 is
  #     survey -> propose -> single agreement + the build-start gate.
  #   - SURVEY = the target repo's own code + structure (languages, layout, README) PLUS
  #     any seed vision and initial backlog — not a blank template, not seed-only.
  #   - Survey+propose is the PRIMARY path (this replaces the hand-authored-only
  #     framing); the fail-closed build-start gate ships with it.
  #
  # The contract is a HYBRID artifact git-tracked in the TARGET repo (reproducible, not
  # machine-local): a structured .swarmforge/contract.yaml the gate parses, plus a
  # generated legible CONTRACT.md for the target's humans. The agreement marker reuses
  # the human_approval structured-field PATTERN (proposed | agreed) — it does NOT
  # replace the per-ticket human_approval gate; the contract firms the overall mandate
  # ABOVE it. Scaffolding rides the already-pure targetBootstrap.ts seam; the gate is
  # consulted at the coordinator's first-build promotion (its enforcing coordinator.prompt
  # rule lands IN this parcel, never hot-edited onto main ahead of the gate, BL-247).
  # Fail-closed: proposed/pending/missing/malformed/unknown -> HOLD, never default-allow.
  # SLICE 2 (iterative negotiation loop) is parked in
  # BL-262-onboarding-contract-agreement.slice-2-negotiation.feature.draft (BL-233).

  Background:
    Given a target repo the swarm is being onboarded onto

  # BL-262 survey-proposes-populated-contract-01
  Scenario: onboarding surveys the repo and proposes a populated contract awaiting agreement
    Given the repo carries code and structure and a seed vision and an initial backlog
    When the swarm onboards the target
    Then it proposes a contract whose scope, out-of-scope, and boundaries are populated from the survey rather than left blank
    And the proposed contract's initial-backlog summary reflects the surveyed backlog
    And the contract is left marked as proposed, awaiting the operator's agreement

  # BL-262 gate-decides-by-agreement-state-02
  Scenario Outline: the build-start gate allows dispatch only for an agreed contract
    Given a contract whose agreement state is "<agreement_state>"
    When the coordinator evaluates the build-start gate
    Then the gate decision is "<gate_decision>"
    And a held decision names the unagreed contract as the reason without crashing

    Examples:
      | agreement_state | gate_decision |
      | agreed          | allow         |
      | proposed        | hold          |
      | pending         | hold          |
      | missing         | hold          |
      | malformed       | hold          |

  # BL-262 legible-view-mirrors-source-03
  Scenario: the generated legible view mirrors the structured source
    Given a contract source with a scope and an agreement state
    When the legible CONTRACT.md view is generated
    Then it shows the same scope and agreement state as the source so the two do not diverge

  # BL-262 reopen-reholds-gate-04
  Scenario: flipping an agreed contract back to pending re-holds the gate
    Given an agreed contract that currently allows dispatch
    When the operator flips the agreement marker back to pending for a scope change
    Then the build-start gate holds dispatch again until the contract is re-agreed
