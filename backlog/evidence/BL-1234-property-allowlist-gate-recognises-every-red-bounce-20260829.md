# QA bounce evidence — BL-1234-property-allowlist-gate-recognises-every-red (2026-08-29)

## Inventory (Article 4.4 — one bounce, complete pass)

Every gate QA owns was run to completion before this bounce; D1 is the only
item that failed.

| Gate | Result |
|---|---|
| Ancestry (`git merge-base --is-ancestor <hardener-merge> <cited-commit>`) | PASS — `02721de45` (BL-1233+BL-1234 hardening pass) is an ancestor of `34b1608baf` (documenter's BL-1234 commit) |
| `required_wiring` (`specs/pipeline/steps/index.js::bl1234PropertyAllowlistGateSteps`) | Confirmed — `require('./bl1234PropertyAllowlistGateSteps')` registered at line 850 |
| Wired into real caller | Confirmed — `swarmforge/scripts/check_property_suite_drift.sh` sources `property_suite_standing_allowlist_lib.sh` (line 35) and calls `ps_suite_failures_all_allowlisted` (line 246); not dead code — this exact code path fired live during this same QA pass's own `git commit` of the BL-1233 evidence file ("property-suite-guard: skip-paths") |
| `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1234-property-allowlist-gate-recognises-every-red.feature` | PASS — 4/4 scenarios |
| `swarmforge/scripts/test/test_property_suite_drift_guard.sh` (real git, real pre-commit hook) | PASS — `ALL PASS` (18 scenarios), including 11/13b/13c/13d, the BL-1234-specific multi-file allowlist cases |
| qa_e2e_procedure steps 1-4 | Satisfied by the shell test above: step 1 → scenarios 11/13b/13c (1, 2, 5 allowlisted files all pass); step 2 → scenario 13d (unlisted file among allowlisted named alone, never concatenated); step 3 → scenario 11 (real commit through the pre-commit hook allowed); step 4 → scenario 12 (genuine non-allowlisted red still refuses) |
| Docs currency | `docs/reference/Specification.MD` updated and dated 2026-08-29 for BL-1234, citing the feature file. No dedicated how-to page — none is named in the ticket's scope, and the fix is a one-line internal defect with no new externally-facing behavior to document beyond the Specification entry. |
| `npm run test:properties` — repo-wide | **D1 fails** (this ticket's own new file); rest is pre-existing standing red already covered by the BL-1233 bounce pass on this same merge lineage |
| Full unit suite | Unaffected by this ticket's own merge — diffed `git diff --name-only HEAD^2 HEAD^1` for the BL-1234 merge: only `docs/reference/Specification.MD` plus unrelated backlog/specs housekeeping (BL-1223/1257/1258 paused tickets, BL-1237/1238/1247/1249 evidence) carried along on the documenter branch; zero code files. The code fix itself (`property_suite_standing_allowlist_lib.sh`, the `.tsv`) was already present in the BL-1233 merge this builds on and was already covered by the full-suite run recorded in that ticket's own bounce evidence (38 pre-existing failing files, none touching BL-1234's files either) |
| Orphaned test/mutation processes | None of QA's own before or after this pass. A second live `vitest`/`npm run test:properties` process tree was observed (different PIDs than the BL-1233 pass), traced via full `ps` ancestry to the **hardener** worktree's own `git commit -F /tmp/hardender-bl1244-commit-msg.txt` → `pre-commit` hook → `check_property_suite_drift.sh`, itself parented by a live `claude` process — a second, later concurrent legitimate run by another role (BL-1244), not an orphan, left untouched. |

## D1

1. **Failing command**: `cd extension && npx vitest run --config vitest.properties.config.mjs test/bl1234PropertyAllowlistGateRecognisesEveryRed.property.test.js` (reproduces identically inside the full `npm run test:properties` run)
2. **Commit hash**: `d026f8ad1a` (QA worktree HEAD — QA's merge of documenter `34b1608baf` for this ticket)
3. **First error excerpt**:
   ```
   RUN  v3.2.6 /home/carillon/swarmforgevc/.worktrees/QA/extension

   TAP version 13
   # Subtest: BL-1234/BL-654 invariant 1: an all-allowlisted set of ANY generated size is allowed
   ok 1 - BL-1234/BL-654 invariant 1: an all-allowlisted set of ANY generated size is allowed
     ---
     duration_ms: 1131.284077
     type: 'test'
     ...
   # Subtest: BL-1234/BL-654 invariants 1+2: exactly one unlisted file among N allowlisted ones is always refused, and named alone
   ok 2 - BL-1234/BL-654 invariants 1+2: exactly one unlisted file among N allowlisted ones is always refused, and named alone
     ---
     duration_ms: 835.516591
     type: 'test'
     ...

   ⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

    FAIL  test/bl1234PropertyAllowlistGateRecognisesEveryRed.property.test.js [ test/bl1234PropertyAllowlistGateRecognisesEveryRed.property.test.js ]
   Error: No test suite found in file /home/carillon/swarmforgevc/.worktrees/QA/extension/test/bl1234PropertyAllowlistGateRecognisesEveryRed.property.test.js

    Test Files  1 failed (1)
         Tests  no tests
   ```
4. **Failure class**: `unit` (property-test lane; the file is the coder-authored BL-654 invariant property test the ticket's own `invariants:` field requires)
5. **Expected vs observed**: Expected — `npm run test:properties` collects and runs both `BL-1234/BL-654 invariant 1` and `invariants 1+2` tests as part of the live suite. Observed — Vitest's collector registers **zero** tests from the file and reports the suite itself as failed; the assertion bodies only ran because `node:test`'s own runner executed them as a side effect of the `require()` call (hence the stray `TAP`/`ok 1`/`ok 2` lines), never because Vitest counted them.

**Root cause**: `extension/test/bl1234PropertyAllowlistGateRecognisesEveryRed.property.test.js:26` does
`const { test } = require('node:test');` and calls that `test()` directly.
`vitest.properties.config.mjs` sets `globals: true`, and every other passing
property test in this lane (e.g. `test/bl1008BoundedWatchDeadline.property.test.js`)
calls the **global** `test` with no import at all. Explicitly requiring
`node:test` shadows Vitest's global and registers the test with Node's own
test runner instead of Vitest's collector, so Vitest sees the file as empty.

**Same defect, same day, same batch, sibling ticket**: BL-1233's own new
property test file (merged into this worktree immediately before this one,
same coder/hardener/documenter batch pass) carries the identical mistake —
see `backlog/evidence/BL-1233-launcher-guard-survives-ambient-git-env-bounce-20260829.md`.
Both files are new to their own tickets' diffs, so neither qualifies for the
BL-1063 "presumed already ticketed" carve-out (scoped to reds "your own diff
did not touch"). Also matches BL-1249's identical mistake earlier the same
day in this same worktree, and the pre-existing BL-1206/1220/1221 standing-debt
lane sharing the same anti-pattern.

**Remediation pointer**: `extension/test/bl1234PropertyAllowlistGateRecognisesEveryRed.property.test.js`,
remove the `const { test } = require('node:test');` import (line 26) and call
the ambient global `test` instead, matching every passing file in
`test/*.property.test.js` (e.g. `bl1008BoundedWatchDeadline.property.test.js`).
No other file needs a change — this file's assertion content is correct and
was verified to pass once Vitest actually collects it (confirmed via the
`node:test`-runner TAP output above, and independently via
`run_acceptance.sh` and `test_property_suite_drift_guard.sh` both proving the
same predicates correct through the real shell library and pre-commit hook).

**Owning role**: `coder` — the defect is purely in how the test is wired to
its runner (an authoring mistake in a coder-authored property test file), not
in the property/invariant logic itself, the architecture, hardening, or docs.

## Not bounced — pre-existing, confirmed untouched by this ticket

Same standing-red population already dispositioned in the BL-1233 bounce pass
on this identical merge lineage (BL-1206 property lane, BL-1220 unit lane,
BL-1221 pilot-gate deps stub, plus assorted repo-hygiene guard reds) — this
ticket's own merge added no code, only `docs/reference/Specification.MD` plus
unrelated backlog housekeeping, so the failing-file population is identical
to what BL-1233's bounce evidence already recorded and grepped against
`backlog/` (BL-1063).

## Sibling scope

This bounce commit carries only BL-1234's own final documenter commit
(`34b1608baf`) merged into QA, on top of BL-1233's already-merged and
already-bounced commit. BL-1233 was bounced separately (own evidence file,
own `git_handoff` to coder) per Article 2.6 — each ticket forwarded and
adjudicated on its own, never collapsed even though both share a common
hardening ancestor. No `qa-sibling-check.js defer` entries apply — this
ticket has its own failing check (D1), not a shared-blocker deferral.
