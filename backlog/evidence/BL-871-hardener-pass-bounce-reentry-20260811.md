# BL-871 — hardener pass, bounce re-entry — 2026-08-11

## Scope reviewed

Parcel received from architect at `729a4e9445` (architect's bounce-reentry
re-verification of the coder's fix for QA's own bounce,
`backlog/evidence/BL-871-bounce-20260811.md`). This file covers the
bounce-reentry diff only (`052a1f4f0c..79db75ce47`); my original pre-bounce
pass is `BL-871-hardener-pass-20260811.md`.

Files this diff touches: `extension/vitest.properties.config.mjs`,
`extension/test/bl760DuplicateChainGuard.property.test.js`,
`extension/test/bl787NamedTunnelInvariants.property.test.js`,
`extension/test/bl797MutationGateProbeCrashFallback.property.test.js`,
`specs/pipeline/steps/bl871PropertyLaneWorkerPoolCapSteps.js`. All five are
test infrastructure / config / step-handler changes (raised timeouts, one
new Vitest config flag) — no new `extension/src/**/*.ts` logic, confirmed
via `git diff 052a1f4f0c..79db75ce47 --stat`.

## Mutation scope — nothing new to mutation-test

Neither `workerPoolConfigGuard.js` nor its own property test is touched by
this diff (confirmed empty via `git diff --stat` scoped to that file,
matching the architect's own finding). No `src/*.ts` change means no
Stryker/CRAP/DRY scope is touched either (BL-381: those tools key off
`extension/src/**`, none of this diff's files live there). Nothing to
mutation-test this pass.

## Coverage-gap review of the new mechanism

The one new piece of *behavior* in this diff is
`dangerouslyIgnoreUnhandledErrors: true` in
`vitest.properties.config.mjs` — a Vitest-native config flag, not project
code, so there is nothing to unit-test directly. Independently re-verified
it is a real, documented option (`node_modules/vitest/dist/config.d.ts`)
and re-confirmed its scope by grep: absent from `vitest.config.mjs` (the
unit lane), present only here. The architect's own pass already traced
Vitest's bundled source for this flag's exact semantics and assessed the
one residual risk (a different unhandled-error class going equally
unnoticed) as not send-back-worthy, filing a non-blocking `rule_proposal`
for a future supplementary grep-based check. Agree with that judgment — the
flag only gates the exit-code side effect, the "Unhandled Errors" section
still prints (confirmed again in this pass's own clean run below: 5 error
blocks logged, exit still 0), and no narrower Vitest API exists to do
better today.

The three raised-timeout files (`bl760`, `bl787`, `bl797`) and the step
handler's raised `spawnSync` timeout are tuning constants, not branching
logic — nothing productive to hand-mutate there (a timeout value has no
"survivor" in the mutation sense; either the real subprocess finishes
inside the budget or it does not, which is exactly what the verification
below checks empirically rather than via a synthetic mutant).

## Verification

- `npm run compile`: clean.
- `npm test`: 422/422 files pass (ran during this pass's window; some
  individual files logged "exceeds the N.Ns per-file budget" warnings
  under transient host contention from concurrently running the property
  lane — informational, not failures, and none touch this ticket's scope).
- **Full property lane, run standalone at normal load** (after an earlier
  same-pass attempt overlapped with the unit suite and pushed load to
  ~260 on this 4-CPU host — an artifact of running both concurrently, not
  a code defect; re-ran alone once that contention cleared):
  `npx vitest run --config vitest.properties.config.mjs` — **73/73 files
  passed, 232/232 tests passed**, 5 "Unhandled Error: [vitest-worker]:
  Timeout calling onTaskUpdate" blocks logged (the confirmed-benign RPC
  heartbeat artifact this diff's `dangerouslyIgnoreUnhandledErrors` exists
  to absorb) but the run still exited clean, 457.95s total — matching the
  coder's (400.24s-449.5s) and architect's own baseline measurements. This
  is the exact mechanism scenario 04 and the ticket's own invariant 1 care
  about, independently reproduced end-to-end on this host, not taken on
  either prior pass's word.
- Five required-wiring/BL-877-adjacent shell tests unrelated to this
  ticket's own scope, re-run this same pass for the batch as a whole (see
  `BL-877-bounce-20260811.md`): confirms host load had returned to a normal
  reading by the time of these checks (`test_operator_runtime_fixture_reaper_sweep_bounded_progress.sh`
  failed once under the self-inflicted ~260 load spike, re-ran clean
  immediately after — load-induced flake, not a regression, logged here so
  the flake doesn't look like unexplained missing coverage).
- Acceptance suite: not re-run standalone a second time this pass — the
  direct property-lane run above already independently re-proves the exact
  mechanism scenario 04 checks (a full-suite run reaching a clean exit),
  and running both back-to-back is what caused this pass's own load spike
  in the first place. Scenario 04's own acceptance-level pass remains on
  record from the architect's most recent evidence (7/7 scenarios,
  449.5s, this same commit range).

## Verdict

No defect found in this diff's own scope. The D1/D2/third-mechanism fix
verified end-to-end, independently, at normal load: 73/73 files, 232/232
tests, clean exit. Forwarding to documenter.

By hardender.
