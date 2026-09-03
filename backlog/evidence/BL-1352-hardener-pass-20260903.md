# BL-1352 hardener pass — 2026-09-03

Merged architect commit `cfea54de48` (clean sweep, no defect) onto this
worktree as a clean auto-merge (no conflicts).

## required_wiring re-verified
- `swarm_status.bb::ask_escalation` — present, reads
  `.swarmforge/operator/status.json`'s `:ask_escalation` key and is
  called into the rendered status map.
- `specs/pipeline/steps/index.js::bl1352EscalationTransportFaultSteps`
  — registered.

## Babashka/no-tooling posture (engineering.prompt, Startup Tools)
All production code touched is `.bb`
(`operator_runtime.bb`, `role_ask_escalation_lib.bb`, `swarm_status.bb`,
`swarm_status_lib.bb`) — no Stryker/CRAP/DRY wired. Gated by its own
suite:
- `bb swarmforge/scripts/test/bl1352_escalation_transport_test_runner.bb`
  — re-run here, ALL PASS.

## Acceptance
`node specs/pipeline/cli.js
specs/features/BL-1352-escalation-transport-fault-is-visible.feature` —
7/7 pass, re-run here.

## BL-113 Gherkin soft mutation
Two `Scenario Outline:` blocks — 01 (the transport/questions/state
4-row matrix) and 03 (the log-line-count 2-row matrix). Ran
`run_gherkin_mutation.sh` in fresh `mktemp -d`, `soft` mode: **16/16
killed, 0 survived, 0 errors**. Manifest stamp written into the feature
file (kept, committed).

## Property tests
- `bl1352EscalationVisibilityInvariants` — re-run 5 consecutive times,
  2/2 each (matches architect's D1-fix confirmation: the reach floor for
  invariant 1's idle/waiting arms is guaranteed by construction via
  `fc.constant([])` vs `fc.uniqueArray(..., {minLength: 1})`, not by
  chance).
- The two incidental property-test fixes that rode in on this branch
  (`bl1323StampOffInvariants`, `bl1306AuditKeyBasisInvariants`) —
  independently re-run here too (not just trusted from the architect's
  evidence): 5/5 pass. Agree with the architect's read that both are
  legitimate, correctly-scoped fixes for unrelated pre-existing breakage
  (BL-1323's whole-branch-diff scope, BL-1306's default Vitest timeout),
  not BL-1352's invariants and not touched further here.

## Standing whole-tree guards
Parcel touches `specs/pipeline/steps/` and adds a new
`extension/test/` property test file. Ran all 17 `test/*Guard*.test.js`
(excluding `.property.` siblings). Same 3 pre-existing, already-ticketed
failures as this session's two earlier passes (BL-1289/1290/1291) —
confirmed by grep that none names `bl1352EscalationTransportFaultSteps.js`,
`bl1352EscalationVisibilityInvariants.property.test.js`, or any of the
four touched `.bb` files.

## Other checks
- `node out/tools/dependency-gate.js` — PASSED, no forbidden edges.
- `pgrep -fl 'node --test|stryker'` scoped to this worktree — clean.
- `npx jscpd --config .jscpd.json` is TS-only — N/A, no `.ts` files in
  this parcel's diff.

## Verdict
No defect found; nothing beyond what the architect already verified.
Forwarding to documenter.
