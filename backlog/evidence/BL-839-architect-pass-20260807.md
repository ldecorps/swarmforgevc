# BL-839 — architect pass (2026-08-07)

## Received

`git_handoff` from cleaner, commit `25c24fd156` (merge_and_process, task
`BL-839-master-checkout-drift-from-main-on-daemon-executed-scripts`), bundled
with BL-773/BL-819/BL-822 in one coder→cleaner batch commit. Merged into
`swarmforge-architect`.

## Scope

New ticket, first architect pass. Report-only master-checkout-vs-`main` drift
detector (`master_checkout_drift_lib.bb` + `master_checkout_drift_cli.bb`),
wired into `handoffd.bb`'s existing sweep cadence.

## Two declared invariants — property coverage checked first (BL-654)

Both have real coverage in
`swarmforge/scripts/test/bl839_master_checkout_drift_property_runner.bb`,
run and green:

```
bb swarmforge/scripts/test/bl839_master_checkout_drift_property_runner.bb
bl839_master_checkout_drift_property_runner: ok
```

- Invariant 1 (never writes): P1, 24 real-fixture-repo trials across
  clean/staged-only/unstaged-only/staged-plus-further-edited mutations,
  asserting a byte-level repo fingerprint (`git status --porcelain`, HEAD,
  raw `.git/index` bytes, content digest over every working-tree file) is
  identical before/after the check runs. All four generator branches
  confirmed hit.
- Invariant 2 (fail-closed): P2a, a pure fuzz over
  `classify-drift`/`aggregate-verdict` — any injected false `-ok?` forces
  `:unknown`, never `:no-drift`/`:drift` (60 trials, both branches hit). P2b,
  real-git end-to-end — no `main` branch at all, and a daemon-executed file
  deleted off disk (never chmod, per this project's guardrail) — both report
  `:unknown` (10 trials, both shapes hit).

Read the implementation directly to confirm non-vacuity is plausible, not
just claimed: `check-master-checkout-drift!`'s only git calls are `show` /
`rev-parse --verify` (read-only plumbing); its only filesystem calls are
`slurp`/`fs/exists?`. No `checkout`/`reset`/`add`/`stash`/`commit` anywhere
in the lib. `classify-drift` uses explicit `-ok?` flags, never
nil-as-sentinel, and `aggregate-verdict` ranks `:unknown` above
`:drift`/`:no-drift`.

## Other checks run

- Unit runner: `bb swarmforge/scripts/test/master_checkout_drift_lib_test_runner.bb`
  — `ALL TESTS PASSED`.
- Wiring: `bash swarmforge/scripts/test/test_handoffd_master_checkout_drift_wiring.sh`
  — launches the REAL `handoffd.bb` against a fixture repo with genuine
  drift, confirms the real Telegram OPERATOR-topic outbox line names the
  drifted script and states the stakes, and confirms the fixture's dirty
  state is untouched after the sweep runs. `ALL TESTS PASSED`.
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-839-master-checkout-drift-from-main-on-daemon-executed-scripts.feature`
  — 9/9 scenarios PASS.
- `handoffd.bb` diff: the new sweep is `load-file`d alongside the other
  `_lib.bb` requires, called unconditionally in the same cadence block as
  `flow-watchdog-sweep!` (matching that sweep's own "must not go quiet
  alongside pause/wake-suppression" rationale), wrapped in its own
  `try/catch` so a drift-check exception cannot take down the daemon's other
  sweeps.
- Architecture: this is swarm infrastructure (`.bb`), not extension
  TypeScript — the two-layer view/substrate boundary and the
  dependency-gate tool (TS-scoped) do not apply. No extension `src/` files
  touched by this ticket.
- Co-change (`co-change-report.js` on the two new lib/cli files): coupled
  only with their own test/step-handler files — expected, not suspicious.
- `backlog/evidence/BL-839-qa-destroyed-repro-evidence-20260807.md`
  (traveling with this parcel): a separate QA operational incident against
  the *original* dirty-checkout repro, not a defect in this ticket's own
  code — the ticket's `notes:` already scope "cleaning up the specific
  2026-08-06 reversion" as out_of_scope, and the detector itself is what
  this evidence file reviews. Nothing for me to act on here.

## Verdict

Both declared invariants have real, non-vacuous property coverage; all
checks pass. No architecture violations, no correctness defects found.
Forwarding to hardener.

By architect.
