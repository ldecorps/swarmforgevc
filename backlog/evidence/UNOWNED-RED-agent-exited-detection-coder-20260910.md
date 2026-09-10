# Unowned red: AGENT_EXITED detection fails across three acceptance features

Found by the coder while running the BL-1449 qa_e2e_procedure (running the
five OPERATOR_RUNTIME_BB_FILES consumers' features to confirm the derived
list still boots the runtime). No existing `backlog/standing-reds.tsv` row
(lane `acceptance`) names any of these scenarios.

## Shape

Once the ninth-drift crash (missing `respawn_bootstrap_lib.bb`, BL-1449's
own subject) stops masking these scenarios by aborting `bb
operator_runtime.bb --tick-once` outright with a `FileNotFoundException`,
the tick now completes but the swarm's own dead-agent detection sweep
reports no `AGENT_EXITED` event for a killed tmux session, in every
scenario that exercises it:

- `specs/features/BL-359-always-on-operator-presence.feature` scenario 6
  ("An always-on Operator never suspends the swarm's own recovery"),
  handler `specs/pipeline/steps/alwaysOnOperatorPresenceSteps.js:282-286`
  — `expected QA still reported AGENT_EXITED even with a live Operator
  presence, got:` (empty).
- `specs/features/BL-647-rotation-router-liveness.feature` scenarios 2-6
  (all but "no dead agents" and "stale marker") — e.g. "expected exactly
  one AGENT_EXITED event, got: []".
- `specs/features/BL-368-control-loss-is-not-agent-death.feature` scenario
  3 ("A genuinely dead agent is still detected and recovered") —
  "expected QA reported as AGENT_EXITED, got:" (empty).

Reproduced identically on a clean `origin/main` (c82509179d) checkout with
BL-1449's fix applied by hand (to get past the load crash so the real
assertion runs) — this is not caused by BL-1449's change, which only
touches `operatorRuntimeBbFixtureFiles.js`'s derivation and never the
detection sweep in `operator_runtime.bb`/`operator_lib.bb`. It was already
broken; the ninth-drift crash simply aborted every one of these scenarios
before reaching the assertion, so nothing before now observed it (same
"red hidden by the per-feature runner" shape as BL-1462/1464/1482/1483).

## Out of scope for BL-1449

BL-1449's scope is the fixture file list derivation only (`required_wiring`
+ invariants); the dead-agent detection sweep itself is a different
subsystem entirely. Continuing BL-1449's own work unchanged.
