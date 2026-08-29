# QA bounce evidence — BL-1233-launcher-guard-survives-ambient-git-env (2026-08-29)

## Inventory (Article 4.4 — one bounce, complete pass)

Every gate QA owns was run to completion before this bounce; D1 is the only
item that failed.

| Gate | Result |
|---|---|
| Ancestry (`git merge-base --is-ancestor <hardener-merge> <cited-commit>`) | PASS — `02721de45` (BL-1233+BL-1234 hardening pass) is an ancestor of `72239398874c7511b109f3cf98f4be19359fb47f` (documenter's BL-1233 commit) |
| Compile (`npm run compile`) | PASS |
| `required_wiring` #1 (`sync_worktree_scripts.bb::GIT_INDEX_FILE`) | Confirmed — `scrubbed-git-env` dissoc's `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`, used by every `git-sh` call in the file |
| `required_wiring` #2 (`specs/pipeline/steps/index.js::bl1233LauncherGuardAmbientGitEnvSteps`) | Confirmed — `require('./bl1233LauncherGuardAmbientGitEnvSteps')` registered at line 849 |
| Wired into real caller | Confirmed — `swarmforge/scripts/swarmforge.sh:1165`/`1168` calls `sync_worktree_scripts.bb`, invoked from `sync_worktree_scripts` at line 2235; not dead code |
| `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1233-launcher-guard-survives-ambient-git-env.feature` | PASS — 3/3 scenarios |
| `swarmforge/scripts/test/test_sync_worktree_scripts_never_clobbers.sh` (real git, real ambient env, real subprocess) | PASS — `ALL PASS`, including the 4 BL-1233-specific scenarios |
| `bb swarmforge/scripts/test/sync_worktree_scripts_lib_test_runner.bb` (pure-logic unit coverage) | PASS — `ALL TESTS PASSED` |
| qa_e2e_procedure step 7 — re-run BL-373's own acceptance scenarios | PASS — 6/6 scenarios green, no regression |
| Docs currency | `docs/how-to/BL-1233-launcher-guard-survives-ambient-git-env.md` accurately describes the scrub + fail-closed backstop + the three invariants; linked from `docs/index.md:124`; cross-links to `BL-1195-worktree-drift-guard.md` and the BL-1196 doc both resolve |
| `npm run test:properties` — repo-wide | **D1 fails** (this ticket's own new file); rest is pre-existing standing red (see "Not bounced" below) |
| Full unit suite (`npm test` / `recordTestDuration.js`) | 38 files / 17 tests fail — pre-existing standing red, none touching BL-1233's files (see "Not bounced" below) |
| Orphaned test/mutation processes | None of QA's own before or after this pass. A live `vitest`/`npm run test:properties` process tree was observed mid-run (PGID 327282), but its full ancestry chain traces to the **hardener** worktree's own live `git commit` → `pre-commit` hook → `check_property_suite_drift.sh`, itself parented by a live `claude` process (`--settings .../hardender.claude-settings.json`) — a concurrent legitimate run by another role, not an orphan, and left untouched. |

## D1

1. **Failing command**: `cd extension && npx vitest run --config vitest.properties.config.mjs test/bl1233AmbientGitEnvNeverBlindsTrackedPathGuard.property.test.js` (reproduces identically inside the full `npm run test:properties` run)
2. **Commit hash**: `ab31f9abb1` (QA worktree HEAD — QA's merge of documenter `7223939887` for this ticket)
3. **First error excerpt**:
   ```
   RUN  v3.2.6 /home/carillon/swarmforgevc/.worktrees/QA/extension

   TAP version 13
   # Subtest: BL-1233/BL-654 invariants 1+2: an untrustworthy tracked-path answer never results in a copy, trustworthy match always resolves as such
   ok 1 - BL-1233/BL-654 invariants 1+2: an untrustworthy tracked-path answer never results in a copy, trustworthy match always resolves as such
     ---
     duration_ms: 223.526916
     type: 'test'
     ...
   # Subtest: BL-1233/BL-654 invariant 3: a foreign target that genuinely tracks nothing still copies every generated path
   ok 2 - BL-1233/BL-654 invariant 3: a foreign target that genuinely tracks nothing still copies every generated path
     ---
     duration_ms: 173.341142
     type: 'test'
     ...

   ⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

    FAIL  test/bl1233AmbientGitEnvNeverBlindsTrackedPathGuard.property.test.js [ test/bl1233AmbientGitEnvNeverBlindsTrackedPathGuard.property.test.js ]
   Error: No test suite found in file /home/carillon/swarmforgevc/.worktrees/QA/extension/test/bl1233AmbientGitEnvNeverBlindsTrackedPathGuard.property.test.js

    Test Files  1 failed (1)
         Tests  no tests
   ```
4. **Failure class**: `unit` (property-test lane; the file is the coder-authored BL-654 invariant property test the ticket's own `invariants:` field requires)
5. **Expected vs observed**: Expected — `npm run test:properties` collects and runs both `BL-1233/BL-654 invariants 1+2` and `invariant 3` tests as part of the live suite. Observed — Vitest's collector registers **zero** tests from the file and reports the suite itself as failed; the assertion bodies only ran because `node:test`'s own runner executed them as a side effect of the `require()` call (hence the stray `TAP`/`ok 1`/`ok 2` lines), never because Vitest counted them.

**Root cause**: `extension/test/bl1233AmbientGitEnvNeverBlindsTrackedPathGuard.property.test.js:33` does
`const { test } = require('node:test');` and calls that `test()` directly.
`vitest.properties.config.mjs` sets `globals: true`, and every other passing
property test in this lane (e.g. `test/bl1008BoundedWatchDeadline.property.test.js`)
calls the **global** `test` with no import at all. Explicitly requiring
`node:test` shadows Vitest's global and registers the test with Node's own
test runner instead of Vitest's collector, so Vitest sees the file as empty.

**This is the same failure shape the specifier already dispositioned as
BL-1206/BL-1220/BL-1221** ("assertions counted as coverage that have never
run"), and the identical shape BL-1249 hit in this same worktree the same day
(`backlog/evidence/BL-1249-expeditor-restart-honours-the-operator-pause-marker-bounce-20260829.md`)
— but BL-1233's file is new, written by this ticket's own coder stage
(comment at the top of the file: "coder first authorship - BL-654"), so it is
this ticket's own defect and does not qualify for the BL-1063 "presumed
already ticketed" carve-out (that carve-out is explicitly scoped to reds
"your own diff did not touch").

**Remediation pointer**: `extension/test/bl1233AmbientGitEnvNeverBlindsTrackedPathGuard.property.test.js`,
remove the `const { test } = require('node:test');` import (line 33) and call
the ambient global `test` instead, matching every passing file in
`test/*.property.test.js` (e.g. `bl1008BoundedWatchDeadline.property.test.js`).
No other file needs a change — this file's assertion content is correct and
was verified to pass once Vitest actually collects it (confirmed via the
`node:test`-runner TAP output above, and via `run_acceptance.sh` and
`test_sync_worktree_scripts_never_clobbers.sh` both independently proving the
same predicates correct through the real `.bb` library and CLI).

**Owning role**: `coder` — the file's own header comment attributes it to
"coder first authorship - BL-654," and the defect is purely in how the test
is wired to its runner, not in the property/invariant logic itself, the
architecture, hardening, or docs.

## Not bounced — pre-existing, confirmed untouched by this ticket

Grepped `backlog/` for each of the 38 failing unit-suite file basenames
(BL-1063) — every one returns hits, consistent with the specifier's standing
disposition (BL-1206 property lane, BL-1220 unit lane, BL-1221 pilot-gate
deps stub, plus assorted repo-hygiene guard reds) recorded in
`backlog/evidence/specifier-disposition-qa-standing-red-note-20260828.md` and
its addendum.

- **Full unit suite**: `Test Files 38 failed | 530 passed (568)`, `Tests 17
  failed | 9309 passed (9326)`. None of the 38 failing files are among the
  files this ticket's merge touches (diffed the failing-file list against
  `git diff --name-only HEAD^1...HEAD^2` and `git diff --name-only HEAD^2
  HEAD^1` for the BL-1233 merge — zero overlap).
- **Property lane, remaining failing files**: same `require('node:test')` or
  a sibling pattern, per the specifier's note. None are files this ticket
  touches; BL-1233's own new file (D1 above) is the only new-to-this-diff
  member of that set.

## Sibling scope

This bounce commit carries only BL-1233's own final documenter commit
(`7223939887`) merged into QA — BL-1234's parcel (`documenter` commit
`34b1608baf`, task `BL-1234-property-allowlist-gate-recognises-every-red`)
is a separate `git_handoff` still sitting in `inbox/new/`, not yet claimed
or merged into this worktree, so no `qa-sibling-check.js defer` entries
apply here.
