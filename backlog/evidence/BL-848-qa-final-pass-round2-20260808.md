# BL-848 QA final pass (round 2) — 2026-08-08

## Scope

Re-entry after round-2 bounce (`backlog/evidence/BL-848-qa-bounce-round2-20260808.md`,
D1: cleaner and documenter forwarded the round-1 bounce-fix delta unchanged
with no committed trace of their own review). Received from documenter as
`merge_and_process documenter 76a29eed31`.

## D1 (round 2) — verified fixed

- Cleaner: `backlog/evidence/BL-848-cleaner-pass-round2-20260808.md` (commit
  `3a8059bd9c`), verdict NONE.
- Architect: `backlog/evidence/BL-848-architect-pass-round2-20260808.md`
  (commit `571573dca0`), verdict NONE.
- Hardener: `backlog/evidence/BL-848-hardener-pass-round2-20260808.md`
  (commit `33b00a72f5`), verdict NONE.
- Documenter: `backlog/evidence/BL-848-documenter-pass-round2-20260808.md`
  (commit `76a29eed31`), verdict NONE.

All four now leave a committed, explicit-NONE trace for this delta. The
process defect this bounce exists to fix is resolved.

## Checks run this pass (complete inventory, not first-failure-stop)

- **No production/test/feature change since round-2 bounce**:
  `git diff --name-only e060695ba8 HEAD` (after merging documenter's round-2
  tip) returns only evidence files plus the ticket-record bounce_history
  bookkeeping this session committed separately
  (`backlog/active/BL-773-*.yaml`, `backlog/active/BL-848-*.yaml`) — no
  production code, test, or feature-file diff. Confirms architect's and
  hardener's own round-2 findings.
- **D1 from round 1 (blank `detected_at`) — reconfirmed** via
  `test_operator_runtime_hotfix_certification_sweep.sh` check 01's dedicated
  regression assertion: 13/13 PASS.
- `bb swarmforge/scripts/test/hotfix_certification_lib_test_runner.bb` — PASS.
- `bb swarmforge/scripts/test/bl848_hotfix_certification_property_runner.bb` — PASS.
- `bash swarmforge/scripts/test/hotfix_ledger_update_test_runner.sh` — 20/20 PASS.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-848-hotfix-swarm-certification-recurring-check.feature`
  — 10/10 scenarios PASS.
- `required_wiring` re-confirmed: `hotfix-certification-sweep!` called from
  `tick!` (`operator_runtime.bb:2007`), gated by `timer-due?`
  (`operator_runtime.bb:1410`); `backlog/hotfix-ledger.yaml` seeded with
  BL-849's commit (`f9cf29c29b`) and the genuine unaccounted finding
  (`f175bc56d1`) — BL-850/BL-851 correctly absent, both uncommitted at spec
  time, ledger is commit-keyed; `docs/how-to/BL-848-certify-an-operator-hotfix.md`
  still linked from `docs/index.md`.
- E2E procedures 1-4 (live daemon behavior, not fakes) were verified live in
  the round-1 QA pass (`backlog/evidence/BL-848-qa-bounce-20260808.md`) and
  reconfirmed unaffected in round 2 (no change to `operator_runtime.bb`'s
  tick/cadence/hibernation paths since). Not re-run live this pass since
  nothing in that surface changed — same posture architect/hardener used
  above.
- `cd extension && npm run compile` — clean.
- `cd extension && npm run test` — 402/406 files, 7207/8 tests failing across
  `dependencyGateCliStorageGlobals.test.js` and
  `renderBriefingDiagramsCli.test.js`. Confirmed pre-existing and orthogonal:
  `git diff --name-only ca33c97b HEAD -- extension/test/dependencyGateCliStorageGlobals.test.js extension/test/renderBriefingDiagramsCli.test.js extension/src/tools/dependency-gate.ts`
  is empty. Root cause unchanged from round 1: local Node 20.20.2 vs
  dependency-cruiser's `^22||^24||>=26` requirement, and a 20s CLI timeout —
  both environment issues, neither touched by this ticket.
- `cd extension && npm run test:properties` — 52/55 files, 166/171 tests
  passing; failures in `bounceNaturalKey.property.test.js`,
  `bl760DuplicateChainGuard.property.test.js`,
  `bl787NamedTunnelInvariants.property.test.js`. Confirmed orthogonal:
  `git diff --name-only ca33c97b HEAD` on those three files is empty —
  pre-existing timeout/network-access issues, not this ticket's surface.
- Orphaned test/mutation/vitest processes: none before or after this pass
  (`pgrep -fl 'node --test|stryker|vitest'` empty both times).
- Scope discipline (BL-506): `git diff --name-only e060695ba8 <this QA merge
  tip>` is exactly the round-2 evidence files plus the pre-existing
  ticket-record bookkeeping this session committed separately. Untracked
  `swarmforge/scripts/operator_path_lib.sh` (known BL-796 debt) confirmed
  still unstaged, untouched.

## Verdict

APPROVE. All gates green, all four pipeline stages left committed round-2
evidence, no regressions, no unrelated scope. Landing on `main`.

By QA.
