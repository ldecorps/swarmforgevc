# BL-1206 — hardener pass, 2026-09-05

Ticket: BL-1206-drain-the-node-test-import-entries-from-the-property-allowlist
Commit reviewed: e29ab2d1d0 (cleaner) / e1da4ff584 (architect, NONE pass)

## Result: ONE gap found via BL-113 mutation and fixed in this pass — the
   acceptance step handler's own scenario 04, not the ticket's substance

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `grep -l "require('node:test')" test/*.property.test.js` | only 2 hits, both confirmed false positives: `nodeTestImportGuard.property.test.js` (BL-1220's own fixture data) and this ticket's own new `bl1206PropertyLaneAllowlistInvariants.property.test.js` (its own fixture data — read the source, confirmed no real import) |
| All 14 converted files, run together | 14/14 files, 50/50 tests pass |
| `nodeTestImportGuard.test.js` + `bl1206PropertyLaneNodeTestImportGuard.test.js` | 14/14 |
| `nodeTestImportGuard.property.test.js` + `bl1206PropertyLaneAllowlistInvariants.property.test.js` | 6/6 |
| DRY-fix re-verification: `findUnitLaneNodeTestImports`/`findPropertyLaneNodeTestImports` | both confirmed (by reading the source) to delegate to the shared `findNodeTestImportsForLane` walk, differing only in the lane predicate — no duplication |
| Full unit lane | 6 failed / 600 passed (606) — identical unrelated failure set to every prior ticket this session |
| Full properties suite (`npx vitest run --config vitest.properties.config.mjs`, backgrounded twice for its ~260s runtime) | first run at load 4.8-7.9: 3 failed (incl. `tempDirTrapGuard.property.test.js`, a crash); **re-ran `tempDirTrapGuard` alone: 9/9 pass**, confirming a load flake, not a regression; a second full-suite run (grep-filtered) showed only the single genuine `hostActivityFeed.property.test.js` failure, matching the coder's/architect's own reported state exactly |
| `check_standing_red_register.sh` / `check_property_suite_drift.sh` | both exit 0 |
| `grep -c allowlist property_suite_standing_allowlist.tsv` | 1 (only `hostActivityFeed.property.test.js`, correctly left alone) |
| `npm run compile` | clean |
| acceptance `BL-1206-...feature` | 7/7 scenario runs (before AND after the fix below) |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after).

## BL-113 soft gherkin mutation — found a real gap, fixed it

First run: `specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1206-...feature <fresh mktemp under ./tmp>
specs/pipeline/steps/index.js soft` (all 4 positionals explicit).
**Result: 3 mutants, 0 killed, 3 SURVIVED** — every `<file>` cell in
scenario 04's Outline (single-letter case flips).

### Root cause

`bl1206DrainTheNodeTestImportEntriesFromThePropertyAllowlistSteps.js`'s
scenario 04 handler reads a register row via `rowFor(text, file) =>
text.split('\n').find(line => line.includes(file))`. For the REAL Examples
values this correctly captures each named file's before/after row and
asserts they are unchanged. But for a MUTATED (nonexistent) filename, no
row in either register file `.includes()` that string — `beforeRows` and
`afterRows` are both `[null, null]`, and `assert.deepEqual([null, null],
[null, null])` passes VACUOUSLY, regardless of the mutation. The mutant
never reaches real register data at all — a textbook instance of the
"Scenario Outline handler picks its downstream check by shape, not by the
pinned literal" class, worsened here because two of the three real
examples (`selfHealTelemetry`, `unreachableStepHandlerCheck`) had already
left the register by the time this ticket ran (fixed by BL-1229 earlier
the same session, per the coder's own evidence) — so `beforeRows ===
[null, null]` is *also* the correct, intended outcome for those two real
values, ruling out "require at least one non-null row" as a fix (it would
break the legitimate case).

### Fix

Pinned the scenario's own three literal Examples values in
`KNOWN_OUTLINE_FILES` and asserted membership at the top of the Given step,
before any row lookup runs — the standard KNOWN_VALUES convention
(engineering.prompt's Acceptance Pipeline section) for exactly this
situation. A mutated cell fails immediately on membership; all three real
values pass unaffected, since register-row presence/absence for those is
irrelevant to this new check.

### Verified

- Re-ran the acceptance feature after the fix: still 7/7 (the fix changes
  nothing for the correct Examples values).
- Re-ran the BL-113 mutation after the fix: **3 mutants, 3 killed, 0
  survived** — confirmed live, not merely reasoned about.
- Re-ran the two guard-family regression suites (unit + property) after
  the fix: unaffected (14/14, 6/6).

This is a test-fixture (acceptance step handler) fix, not a production or
ticket-substance change — within the hardener's remit to strengthen tests
found weak by the mandated mutation pass, per BL-638's own instruction to
close a gap found this way rather than merely report it.

## Design/CRAP/DRY

No production code changed by this pass or by the parcel itself. The one
change is the step-handler hardening above.

## Verdict

One gap found and fixed (acceptance step handler, BL-113 mutation-driven,
not the ticket's own substance). Forwarding to documenter.
