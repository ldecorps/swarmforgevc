# BL-1240 — QA bounce, 2026-08-30

Full inventory (Article 4.4) — one item, everything else checked and clean.

## D1 — `unregistered_test_gate_lib.bb`'s new cross-directory load-file edge breaks the JS-side `swarm_handoff.bb` fixture closure, regressing two already-green tests

1. **Failing command**, exactly as run:

   ```
   cd extension && npx vitest run test/telegramFrontDeskBotCli.test.js
   cd extension && npx vitest run test/telegramFrontDeskBotCli.property.test.js --config vitest.properties.config.mjs
   ```

   Also visible in the full-suite `npm test` / `npm run test:properties` runs.

2. **Commit hash checked out and tested**: `7f6e9cf36ac4d7f6334145a2f7894c8d32ccc566`
   (`Merge documenter BL-1240 0ca3bc03c0 into QA`), this ticket's own tip in
   the QA worktree.

3. **First error excerpt** (direct repro, isolated from the two test files —
   built a fixture the same way `pinnedRepoFixture.js`'s
   `copyLiveScriptClosureInto(dir, ['swarm_handoff.bb'])` does, then ran
   `swarm_handoff.bb` against it):

   ```
   ----- Error --------------------------------------------------------------------
   Type:     java.io.FileNotFoundException
   Message:  <fixture>/swarmforge/scripts/test/suite_inventory_lib.bb (No such file or directory)
   Location: <fixture>/swarmforge/scripts/unregistered_test_gate_lib.bb:42:1

   42: (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "test" "suite_inventory_lib.bb")))
       ^--- <fixture>/swarmforge/scripts/test/suite_inventory_lib.bb (No such file or directory)

   ----- Stack trace --------------------------------------------------------------
   unregistered-test-gate-lib - <fixture>/swarmforge/scripts/unregistered_test_gate_lib.bb:42:1
   swarm-handoff              - <fixture>/swarmforge/scripts/swarm_handoff.bb:24:1
   ```

   In the actual test files this surfaces as (never a thrown error — the
   caller swallows it, BL-410 posture):
   - `test/telegramFrontDeskBotCli.test.js` — 8 failing tests, all in the
     "BL-1203: enqueueRoleAnswerNote ..." family, e.g. `assert.equal(ok,
     true)` gets `false`, or `ENOENT: ... scandir '<root>/.swarmforge/handoffs/outbox'`
     because the note was never delivered at all.
   - `test/telegramFrontDeskBotCli.property.test.js` — `property (BL-1203
     invariant 1): a role receives at most one note per inbound answer
     identity ...` fails on the first draw:
     `AssertionError: expected exactly 1 queued note(s) ... got 0`.

4. **Failure class**: `unit` — a functional regression in the main unit lane
   (and its property-lane sibling), not a compile, acceptance, or spec
   defect.

5. **Expected vs observed**: expected `enqueueRoleAnswerNote` to deliver the
   note through a real `bb swarm_handoff.bb` invocation inside the test
   fixture, same as before this ticket; observed it silently fails to
   deliver because `swarm_handoff.bb`'s newly added dependency
   (`unregistered_test_gate_lib.bb`, wired by this ticket) can no longer
   load inside the fixture.

## Root cause

`unregistered_test_gate_lib.bb` (this ticket, `swarmforge/scripts/`) is the
**first** top-level script under `swarmforge/scripts/` to `load-file` a
dependency that lives in the `test/` subdirectory —
`swarmforge/scripts/test/suite_inventory_lib.bb`, required exactly per
`required_wiring` row 1's reuse mandate. Confirmed no other top-level `.bb`
script did this before (`grep -l 'load-file.*"test"' swarmforge/scripts/*.bb`
returns only this new file; `origin/main`'s `swarm_handoff.bb` has no such
edge).

`extension/test/helpers/pinnedRepoFixture.js`'s `copyScriptClosure` (BL-1038)
builds a fixture's `swarmforge/scripts/` by walking each entry point's
`load-file` closure and copying every dependency **flat** into the target
directory (`loadFileDeps` extracts only the bare `"*.bb"` filename via
regex, dropping any sibling path-component strings like `"test"`; the copy
then does `fs.copyFileSync(src, path.join(targetScriptsDir, name))` with no
subdirectory reconstruction). It has never needed to preserve a
subdirectory before, because no closure it walked ever crossed into one —
this ticket's own change is what exposes that latent limitation.

Two test files pass `swarm_handoff.bb` as (or among) their entry points to
`copyLiveScriptClosureInto` and are the only ones affected (checked every
caller — 11 call sites total, only these two name `swarm_handoff.bb`):
`test/telegramFrontDeskBotCli.test.js:338` and
`test/telegramFrontDeskBotCli.property.test.js:120`.

**This is test-infrastructure only.** A real worktree's
`swarmforge/scripts/test/suite_inventory_lib.bb` exists on disk exactly
where `unregistered_test_gate_lib.bb` expects it, so production
`swarm_handoff.bb` invocations are unaffected — verified directly (BL-1240's
own acceptance driver, `unregistered_test_gate_lib_test_runner.bb`, and the
`test_swarm_handoff_*.sh` regression suites all pass; only the closure-copied
JS fixture is short one file).

## What I checked and did NOT find a problem in

- `required_wiring` rows 1 and 2 — both hold, both non-vacuous on `main`
  (re-verified this pass).
- Ancestry: this ticket's own hardener merge (`041dcf9ca`) is a genuine
  ancestor of the cited documenter tip (`0ca3bc03c0`), which is itself an
  ancestor of `HEAD` — not a sibling-commit mix-up (BL-336 class).
  `depends_on: [BL-973, BL-1239]` both confirmed in `backlog/done/`.
- `unregistered_test_gate_lib_test_runner.bb` — ALL PASS.
- `bl1240_unregistered_test_gate_property_runner.bb` — ALL PASS, 400
  runs/invariant, non-vacuous coverage.
- BL-1240's own acceptance (`run_acceptance.sh` on its feature file) — 4/4.
- `task_scope_gate_lib_test_runner.bb`, `test_swarm_handoff_sync_deliver.sh`,
  `test_swarm_handoff_daemon_backup.sh` — ALL PASS (this ticket's other
  touched/refactored files).
- `suite_inventory_cli.bb` over the tree — clean, 439 files (BL-1284's fix
  already landed; no inherited drift).
- Full `npm test` (581 files) and `npm run test:properties` (279 files):
  every OTHER failure cross-checked against the backlog and confirmed
  pre-existing, unrelated to this parcel's changed files, and already
  diagnosed in `backlog/evidence/BL-1244-qa-pass-unrelated-reds-20260829.md`
  plus tickets BL-1210, BL-1221, BL-1229, BL-1263, BL-1264, BL-1265 (all
  paused/todo, none of which this parcel touches). D1 above is the only item
  in either full-suite run that is new and root-caused to this ticket.
- Diagram currency: `docs/diagrams/handoff-flow.mmd`'s `VALIDATE` node is
  already an abstraction over `swarm_handoff.bb`'s whole gate chain — the
  pre-existing `task_scope_gate`/`tree_collapse_guard` gates in the same
  chain aren't named individually either, so adding this gate to the same
  chain doesn't make the diagram stale under its own existing abstraction
  level. Not treated as a documenter defect.

## Remediation pointer

Whoever fixes this: `extension/test/helpers/pinnedRepoFixture.js`,
`resolveScriptClosure`/`loadFileDeps`/`copyScriptClosure` — the closure
walker needs to either preserve/reconstruct the `test/` subdirectory for a
dependency that lives there (matching how the real `swarmforge/scripts/`
tree is laid out) or otherwise make `swarm_handoff.bb`'s closure resolve
correctly again. Owning role: **coder** (BL-1240's own producing role — the
break is a direct, mechanical consequence of the load-file edge this ticket
added, in shared test-fixture code, not a docs/hardener/architect-only
defect). Do not weaken `test/telegramFrontDeskBotCli.test.js` or
`.property.test.js`'s assertions to route around this — the fixture must
build a working `swarm_handoff.bb`, not a passing test.

By QA.
