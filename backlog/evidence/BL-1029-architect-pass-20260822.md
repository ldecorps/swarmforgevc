# BL-1029 — architect pass, clean review (Article 4.4: NONE)

Reviewed merge `cf5aa0e15a` (cleaner, pure merge of coder `a55b5156b` — no
additional cleaner diff on BL-1029 files) into the architect worktree. Merged
`main` first (stale `engineering-detailed.prompt` reference), then cleaner's
commit, per [[architect-merge-before-reading-ticket]]. Recompiled
`extension/out/` before running any tool against it, per
[[architect-stale-build-gotcha]].

## Scope

Five respawn call sites converted to a new shared constructor:
`swarmforge/scripts/shell_quote_lib.bb` (new), `single_role_repair_lib.bb`,
`handoff_lib.bb` (x2 sites), `handoffd.bb` (x2 sites),
`remote_control_health_lib.bb`. Three declared-closure fixture lists updated
(`operatorRuntimeBbFixtureFiles.js`, `readLiveRoleHeldTicketsCli.test.js`,
`bl487…Steps.js`, `bl814…Steps.js`). New feature + step handler
(`bl1029RespawnLaunchQuotingSteps.js`, registered in `specs/pipeline/steps/index.js`).
New Babashka test runners: `shell_quote_lib_test_runner.bb`,
`bl1029_respawn_quoting_property_runner.bb`. No `extension/src/**` production
file touched (only a test file).

## Architecture

- Integrate-not-fork: this is legitimate maintenance of the project's own
  maintained SwarmForge fork under `swarmforge/scripts/` (Local Engineering
  Architecture Rule 2) — not a violation of "don't modify SwarmForge" (that
  constraint governs the extension's runtime relationship to a user's
  separately-installed SwarmForge, not this repo's own bundled fork).
- One shared constructor (`shell-quote-lib/launch-command`) is now the only
  place a launch path becomes a shell word — a command *builder*, not just
  the quoting primitive, so the `zsh ` prefix and the quoting can't drift
  apart at a call site. BL-1018's private copy in `single_role_repair_lib.bb`
  is removed, not duplicated (verified: `grep -n "defn.*shell-quote-single"
  swarmforge/scripts/single_role_repair_lib.bb` finds nothing; the file now
  `load-file`s the shared lib).
- `shell_quote_lib.bb` is pure string construction (no subprocess, no IO) —
  confirmed by reading it, and by re-running `daemon_cycle_guard_lib_test_runner.bb`
  and `bl1022_daemon_closure_property_runner.bb` (both green) since
  `handoffd.bb`/`handoff_lib.bb` now load it transitively and the closure gate
  forbids any subprocess path outside the one chokepoint.
- No webview/extension-host boundary touched; no secrets touched.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

Full-repo scan (no TS production file in this parcel's scope):

    Dependency-rule gate FAILED:
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorExec.ts violates "acyclic"
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
      src/tools/telegramCursorOperatorExec.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"

Identical to the three edges recorded in `BL-1066-architect-pass-20260822.md`
(same day, prior parcel) — already tracked as `backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`.
None of this parcel's files (BL-1029 touches no `extension/src/**` production
file at all). Same disposition as BL-1066, BL-1036, BL-1058: not this
parcel's scope.

## Co-change (`node extension/out/tools/co-change-report.js`)

The BL-1029-touched hand-list fixtures (`operatorRuntimeBbFixtureFiles.js`,
`readLiveRoleHeldTicketsCli.test.js`, `bl487…Steps.js`, `bl814…Steps.js`,
`index.js`, `handoff_lib.bb`, `handoffd.bb`) show mutual SUSPECTED COUPLING —
expected and already named: this is exactly the "declared-closure hand list"
pattern BL-814's own comment calls its root cause, and this parcel's coder
evidence records updating all three copies together (the third occurrence of
that staleness, per the comments added). Not new coupling introduced here;
out of this ticket's scope to fix (invariant 2's tree-derived enumeration is
the fix shape, applied only to BL-1029's own site list, per the ticket's
`notes:`). The telegram-file cross-couplings in the same report are noise
from unrelated historical bulk commits, not a live structural signal on
these files. Nothing actionable.

## Invariants review (BL-654/BL-633) — both declared, both real, both verified

| # | Invariant | Test | Verified myself |
|---|---|---|---|
| 1 | every emitted respawn command round-trips through a real shell to the exact original path, incl. apostrophe | `bl1029_respawn_quoting_property_runner.bb` P1, 200 generated paths (`{:apostrophe 56 :plain 39}`, reach floors asserted) + feature scenario 01 (real shell, `sh -c`) | Ran green myself. **Independently broke it**: restored `launch-command` to the pre-fix `(str "zsh '" p "'")` and re-ran the property runner live — 108 failures, all exit-2/"argument is not valid shell" or wrong-recovered-string on apostrophe-bearing paths. Restored, re-ran clean (200/200). Non-vacuous, confirmed, not merely read. |
| 2 | no site quotes a launch path on its own; all route through one shared helper, enumerated from the tree | `bl1029_respawn_quoting_property_runner.bb` P2 + feature scenarios 02/03 | Ran green myself. Read the word-boundary fix (`launch-command(?![\w-])`) the coder's own qa_e2e step 3 found necessary (a plain substring match let a renamed helper still read as "routed") — correct in both the JS step handler and the `.bb` runner. Grepped the tree myself: `grep -rn "zsh '" swarmforge/scripts/ --include="*.bb" | grep -v /test/` → only the one prose comment line in `shell_quote_lib.bb`'s own header, no code interpolation survives. |

No missing/vacuous property test found for either invariant.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

`shell_quote_lib.bb`'s two functions are fully covered by the two declared
invariants above — no further property-shaped gap. The other touched files
(`single_role_repair_lib.bb`, `handoff_lib.bb`, `handoffd.bb`,
`remote_control_health_lib.bb`) are call-site wiring only (one-line swap to
the shared helper); no new pure logic was introduced there needing separate
property coverage. `single_role_repair_lib.bb`'s own existing property runner
(`bl1018_single_role_repair_property_runner.bb`) re-ran green (400 runs,
reach asserted) confirming the wiring change didn't regress its own
invariants. Nothing added.

## Correctness read-through

Read all five converted call sites end to end (diff above). `launch-script`/
`script`/`launch-path` at every site is either already `blank?`-guarded
upstream (`single_role_repair_lib.bb`) or constructed via `(fs/path state-dir
"launch" (str role ".sh"))` (`handoffd.bb`, `handoff_lib.bb`) — never nil in
practice, so `shell-quote-single`'s nil-to-empty-word handling is defensive,
not exercised, and not a behavior change from the pre-fix code (which also
never nil-checked). No defect found.

## Verification re-run live (not trusted from the commit message)

- `npm run compile` (from `extension/`): clean, before running the gate.
- `node extension/out/tools/dependency-gate.js` (full-repo): 3 pre-existing
  edges, BL-759, confirmed above.
- `node extension/out/tools/co-change-report.js` on all 13 parcel files:
  reviewed above.
- `bb swarmforge/scripts/test/bl1029_respawn_quoting_property_runner.bb` →
  green (200/200), then broken/confirmed-red/restored-green as above.
- `bb swarmforge/scripts/test/shell_quote_lib_test_runner.bb` → ALL TESTS PASSED.
- `bb swarmforge/scripts/test/single_role_repair_lib_test_runner.bb` → ALL PASS.
- `bb swarmforge/scripts/test/bl1018_single_role_repair_property_runner.bb` →
  400 runs, ALL PROPERTIES HOLD.
- `bb swarmforge/scripts/test/handoff_lib_test_runner.bb` → ALL TESTS PASSED
  (BL-365).
- `bb swarmforge/scripts/test/daemon_cycle_guard_lib_test_runner.bb` and
  `bl1022_daemon_closure_property_runner.bb` → both green (closure/subprocess
  invariant unaffected).
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1029's feature → **5/5**.
- `swarmforge/scripts/gherkin_lint_gate.sh` on the feature → parses cleanly.
- `npx vitest run` (full unit suite, from `extension/`) → **471 files / 8356
  tests, ALL PASS**.
- `npm run dry` (jscpd) → 34 clones, all pre-existing in `telegram*` files
  this parcel does not touch (identical count to BL-1066's same-day run).
- **BL-487 / BL-814 stay RED, confirmed pre-existing, not this parcel's
  regression**: built a detached worktree at the coder's parent commit
  (`c3a2f7b9f`, before BL-1029's diff) and re-ran both features there —
  BL-487 fails 0/1, BL-814 fails 0/1, identically red before this parcel
  touched anything. Matches the coder's own claim; independently reproduced,
  not merely read.

## Verdict

**NONE.** No architecture violation, no invariant gap, no correctness defect
in the parcel. Forwarding to hardener.

— By architect.
