Feature: ModelFactory assigns recruiter-backed, steward-certified models to swarm roles under a cheap-or-quality steering policy

  # BL-525 (human intake 2026-07-18, expanded): role -> (agent, model, provider)
  # is today static pack config plus ad-hoc operator kill/relaunch when a provider
  # dries up. ModelFactory introduces a single policy engine the swarm calls to
  # answer assign(role, context) -> {agent, provider, model, reason, policy},
  # grounded in Model Steward (BL-547) certification + role matrix and steered
  # toward cheap or quality. Epic: swarm-intelligence-layer (BL-545).
  #
  # SLICE 1 CONTRACT (this file): resolve a full-swarm assignment under a steering
  # mode, honour the certification gate, react to a daily-capped provider being
  # exhausted, and COLD-apply (materialise overlay + stop/relaunch). Slice 2
  # (hot-swap without full restart) is parked in
  # BL-525-model-factory-slice-2.feature.draft and NOT executed by the runner
  # until built (BL-233 slice scoping).
  #
  # SPECIFIER PINS (grounded in shipped code, not invented):
  #  1. Module boundary: Babashka lib + CLI, mirroring the Steward —
  #     swarmforge/scripts/model_factory_lib.bb (pure) + model_factory_cli.bb
  #     (thin main). It CONSUMES the Steward read API in
  #     swarmforge/scripts/model_steward_lib.bb: role-recommendations,
  #     assignment-eligible?, certified? (loaded via model_steward_store.bb
  #     read-registry!). No recruiter/steward re-implementation.
  #  2. Assignment artifact: generated gitignored overlay
  #     .swarmforge/model-factory/assignment.json (role -> {agent,provider,model,
  #     reason,policy}); committed schema + seed under swarmforge/model-factory/
  #     mirroring swarmforge/model-steward/. Cold apply selects/writes an
  #     effective launch input from this overlay — prefer the generated overlay
  #     over editing swarmforge.conf or committing a pack.
  #  3. Exhaustion detector: cheap-mode input is a PURE predicate over an injected
  #     signal map (fixture-friendly for QA forced-exhaustion), backed at runtime
  #     by a local counter/state file .swarmforge/model-factory/quota-state.json;
  #     live HTTP-429 taxonomy (provider_compat_lib.bb provider-auth-error-text?)
  #     is the populate path, wired in a later slice — Slice 1 keeps the detector
  #     injectable so acceptance never depends on a live cap.
  #  4. rotate_to_role interaction (Slice 1): factory is called only on policy
  #     events + explicit operator/coordinator request. Per-hop factory call on
  #     every mono-router rotate is OUT OF SCOPE for Slice 1 (see ticket
  #     out_of_scope) — deferred to a later slice with a cost model.
  #  5. Cold apply uses failover_to_gpt.sh's proven path (kill_all_swarm.sh +
  #     ./swarm --pack ...) as the reference; the live-pane match is verified by
  #     QA's manual e2e (below), NOT an executable scenario — live tmux/PTY is the
  #     project's untestable boundary, so the executable apply scenario asserts
  #     the overlay write + stop/relaunch PLAN via an injected launch seam.

  Background:
    Given the Model Steward registry is initialised with certified and candidate models
    And ModelFactory reads the role matrix, certification status, and provider quota signals

  # BL-525 assign-returns-role-map-01
  Scenario: assign resolves each swarm role to a model with a recorded rationale
    When ModelFactory resolves a full-swarm assignment in "quality" mode
    Then it returns one assignment per swarm role
    And each assignment names an agent, a provider, and a model
    And each assignment records the steering policy and a rationale

  # BL-525 quality-mode-top-certified-02
  Scenario: quality mode picks the top-ranked certified model even when a cheaper one is compliant
    Given role "coder" has a top-ranked certified model and a cheaper compliant certified model
    When ModelFactory resolves the assignment for role "coder" in "quality" mode
    Then the assigned model is the top-ranked certified model for the role

  # BL-525 cheap-mode-lowest-cost-eligible-03
  Scenario: cheap mode picks the lowest-cost eligible model that meets the role floor
    Given role "coder" has eligible certified models of cost class "low" and "medium"
    When ModelFactory resolves the assignment for role "coder" in "cheap" mode
    Then the assigned model is the cost class "low" certified model

  # BL-525 certification-gate-holds-04
  Scenario: an uncertified model is never assigned in production without an override
    Given the only lowest-cost model for role "coder" has status "candidate"
    When ModelFactory resolves the assignment for role "coder" in "cheap" mode
    Then the candidate model is not assigned
    And a certified model is assigned instead

  # BL-525 uncertified-override-05
  Scenario: an explicit operator override permits an uncertified model
    Given the only lowest-cost model for role "coder" has status "candidate"
    When ModelFactory resolves the assignment for role "coder" in "cheap" mode with an uncertified override
    Then the candidate model is assigned
    And the rationale records that an uncertified override was used

  # BL-525 daily-cap-failover-06
  Scenario: cheap mode fails over off a daily-capped provider that is exhausted for today
    Given provider "cerebras" is eligible for role "coder" but its free-daily quota is exhausted for today
    And provider "openai" is an eligible certified fallback for role "coder"
    When ModelFactory resolves the assignment for role "coder" in "cheap" mode
    Then provider "cerebras" is not assigned for that role
    And provider "openai" is assigned before any OpenRouter or Claude paid model

  # BL-525 daily-cap-resets-next-day-07
  Scenario: a daily-capped provider is preferred again after its quota resets
    Given provider "cerebras" was exhausted yesterday and its free-daily quota has reset today
    When ModelFactory resolves the assignment for role "coder" in "cheap" mode
    Then provider "cerebras" is assigned for that role again

  # BL-525 cold-apply-plan-08
  Scenario: cold apply materialises the overlay and produces a stop-then-relaunch plan
    Given ModelFactory has resolved a full-swarm assignment
    When the cold apply helper is invoked with a stubbed launch seam
    Then a resolved assignment overlay is written under the model-factory state dir
    And the plan stops the running swarm and relaunches it against that overlay
