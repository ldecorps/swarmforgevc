# BL-819 architect bounce — 2026-08-07

Reviewed commit: a6f61c28 (merge of cleaner 29c9e1e2 into architect, itself
merging coder 3bfb4347)

## Checks run (Article 4.4 complete inventory)

- `node extension/out/tools/dependency-gate.js` over all 11 changed
  `extension/src/**` files — PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js` over the same files plus
  tests/specs — no pair at or above the suspected-coupling threshold (all
  at frequency 1, first time these files land together).
- Invariants Review (BL-633/BL-654): both declared invariants
  (idempotent double-append / snapshot-is-a-pure-fold; every field
  traceable to a known instrument) have coder-authored, non-vacuous
  property tests in `extension/test/leanLedgerInvariants.property.test.js`
  — break-then-fix documented in the file's own header comment. Ran via
  `npm run test:properties -- leanLedgerInvariants`: 4/4 PASS.
- Full unit suite for the ticket's touched files
  (`leanLedger.test.js`, `leanLedgerCompose.test.js`,
  `leanLedgerStore.test.js`, `leanLedgerRecordCli.test.js`): 54/54 PASS.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-819-ticket-lifecycle-ledger.feature`: 12/12 scenarios
  PASS.
- Module boundary / architecture read (two-layer, extension-host-owns-IO,
  no webview storage, no secrets, integrate-not-fork): no violation — all
  touched files live under `extension/src/{quality,metrics,tools}`, none
  touch the webview or VS Code API surface; `leanLedger.ts` stays pure
  (no `fs`), `leanLedgerStore.ts` is the sole IO layer, the compose
  modules are read-only over already-shipping instruments.

## D1 — both new `.bb` shell-out wiring points have zero test coverage

**Class:** behavior (testability gap in the coder's own wiring, not a
spec ambiguity — engineering-detailed.prompt's CLI-shelling wiring-test
rule binds the coder directly).

**Blamed role:** coder.

**Sites:**
- `swarmforge/scripts/done_with_current_task.bb:34-46`
  (`record-lean-ledger!`, called from `-main` at line 76)
- `swarmforge/scripts/commit_integrity_cli.bb:43-53`
  (`record-lean-ledger!`, called from `-main` at line 102)

**What's missing:** both functions shell to a compiled CLI
(`node .../lean-ledger-record.js ...`) and have a documented,
non-uniform-per-sibling failure contract: non-zero exit → warn to
stderr and continue; thrown exception (spawn failure) → warn to stderr
and continue; CLI file absent → skip silently, no warning. Per
`engineering-detailed.prompt`'s wiring-test rule ("A wiring test that
shells a sweep/adapter out to a CLI or subprocess must drive the
CLI-FAILURE path — a non-zero exit WITH stderr, and a spawn failure —
not only the exit-0 happy path, and assert the sweep's DOCUMENTED
failure contract holds" — the same rule BL-440/BL-511 were bounced
under), this needs a wiring test that proves:
  1. the happy path — a real (or stubbed-successful) CLI is actually
     invoked at the handoff-completion point and at the close-commit
     point, for a ticket the parcel names;
  2. the non-zero-exit path — stderr is printed with the `warn:` prefix
     shown above, and the surrounding operation (handoff completion /
     close commit) still succeeds — never blocked or failed by a ledger
     write failure;
  3. the missing-CLI path — no warning at all when
     `extension/out/tools/lean-ledger-record.js` does not exist (the
     documented "arbitrary managed project" degrade case).

**Verified not already covered:**
- `grep -rln done_with_current_task swarmforge/scripts/test/` finds
  three existing wiring tests (`test_sidecar_tolerant_completion.sh`,
  `test_handoff_state_dir_worktree_root.sh`,
  `test_idle_clear_respawn.sh`), but each builds its fixture as a fresh
  `git init` tmp dir with no `extension/` tree at all — `target-root`
  resolves inside that fixture, `lean-ledger-record.js` never exists
  there, so `record-lean-ledger!` always takes the silent-skip branch.
  None of them was written to exercise this call site and none
  incidentally does — confirmed by running
  `test_idle_clear_respawn.sh` unmodified: it passes with no
  `lean-ledger-record-warn` output anywhere in its log, i.e. the branch
  never fires.
- `test_commit_integrity_cli.sh` has zero references to
  `lean-ledger` / `record-lean-ledger` (`grep -n` empty).
- The feature's own step-handler file
  (`specs/pipeline/steps/bl819TicketLifecycleLedgerSteps.js`) drives the
  compiled `lean-ledger-record.js` CLI and the store/compose modules
  directly against fixture repos (per the feature file's own doc
  comment) — it never invokes `done_with_current_task.bb` or
  `commit_integrity_cli.bb`, so acceptance provides no coverage of the
  wiring either. `grep -n "done_with_current_task\|commit_integrity_cli\|\.bb"`
  on that file returns nothing.

**Remediation pointer:** add a `.bb` wiring test (or extend
`test_idle_clear_respawn.sh`/a new sibling under
`swarmforge/scripts/test/`) that stages a fixture whose `extension/out/`
tree contains a fake `tools/lean-ledger-record.js` (a tiny fake CLI
script, following the fake-`tmux`-binary pattern these tests already
use for other subprocesses) so both branches are reachable: one fixture
variant where the fake CLI exits 0, one where it exits non-zero with
stderr text, one where it's simply absent. Assert the exact behavior
above for `done_with_current_task.bb`'s and `commit_integrity_cli.bb`'s
own call sites.

## Nothing else found

Every other check in this pass (dependency gate, co-change, both
declared invariants, property-test non-vacuity, full unit + acceptance
suites, architecture/boundary read) is clean. This is the only item in
the inventory.
