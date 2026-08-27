# BL-1014 hardener pass — 2026-08-22

**Parcel:** architect forward `23643b250d` (evidence-only commit; the real
diff is the cleaner's split `8274108c3d` of the coder's original single-file
commit `6107c5103`), merged into hardender. Architect reviewed clean, no
defect found, forwarded as-is, with one spec-gap note routed to specifier +
coordinator (stale `required_wiring` path after the cleaner's legitimate
split — not a code defect, not this stage's to fix).

**Verdict: hardened. Five real mutation gaps closed with tests, two CRAP
regressions fixed with behavior-preserving extractions.** This is
`mutation_cost: medium` per the ticket, a brand-new 7-file module, so this
pass went deeper than a `low`-cost single-function ticket would warrant.

## Host load

`uptime` read 183–186 (avg) on 4 cores at pass start — the same severe spike
the architect's own evidence file already recorded (130–173) as a
circuit-breaker-class signal, not something either pass caused. It settled
to 15–46 by the end of this pass. All work below (hand-mutation via targeted
`npm run compile` + single-file `vitest run`, never a full-suite or Stryker
run) stayed cheap enough to run throughout regardless.

## Mutation gaps found and closed (hand-authored, kill/restore verified each time)

The architect's own non-vacuity table proved the three declared invariants
(determinism, evidence-bearing, read-only) correctly catch every break it
tried. All five gaps below are OUTSIDE those three declared invariants —
real behavior the ticket's own test suite (18 unit tests + 2 property tests
at the architect's pass, now 24 + 2) never exercised. Every fix below was
verified by reverting the real change, confirming the *entire* suite
(unit + property, and for two of them the acceptance feature too) still
passed, then adding a test, confirming that test alone fails against the
revert, then restoring (byte-diffed clean each time, recompiling `tsc`
between every step — `out/` does not auto-refresh).

1. **`rankInventory`'s SECOND sort clause (`evidence.length`, the tie-break
   between sourceCount and subject) had no test that could tell it apart
   from being absent entirely.** Every existing "ties" test either varied
   subject alone (equal sourceCount AND equal evidence.length) or varied
   sourceCount (the first clause dominates). Deleting the middle clause
   outright left all 18 original unit tests AND both property tests green —
   the property test's own permutation-invariance check doesn't care which
   comparator produced the order, only that forward and reversed agree, so
   it can't distinguish "3 clauses" from "2." Added a test with two subjects
   at an EQUAL sourceCount but different total hit counts, asserting the
   busier one outranks the quieter one before subject ever applies.

2. **`parseBounceRecords`'s `!rec.failureClass || !rec.producingRole` guard
   is an OR of two independent checks; every existing fixture had both
   fields present or both absent (via malformed JSON), so a mutant dropping
   either half of the OR survived.** Reducing the guard to check only
   `failureClass` (silently letting a `producingRole`-less record through)
   left the whole suite green; the symmetric break (checking only
   `producingRole`) did too. Added a test with two records, each missing
   exactly one of the two fields, asserting both are skipped. Confirmed both
   independent breaks now fail.

3. **`scan()`'s ternary distinguishing "empty CRAP/duplication report" (→
   unavailable) from "clean report" (→ available, count 0) had NO dedicated
   unit test at all** — `scan` wasn't even imported into the unit test file
   before this pass. The property test's `broken` flag couples an empty
   `crapReport`/`duplicationReport` string to a SIMULTANEOUSLY throwing
   `hardeningLedger`, so its "some source unavailable" assertion was
   satisfied by the ledger's throw regardless of whether crap/duplication's
   own branch was correct; the acceptance feature's clean-repository
   scenario deliberately uses a NON-empty (but below-threshold) report
   precisely to test the *other* branch, so it never touches this one
   either. Reverting either ternary (`crapText.trim() === ''` /
   `dryText.trim() === ''`) to always answer "available" left the unit
   suite, property suite, AND acceptance feature (10/10) all green.
   Added `scan` to the test file's imports and three direct unit tests:
   truly-empty CRAP → unavailable, non-empty-but-clean CRAP → available with
   count 0, truly-empty duplication → unavailable. All three independently
   confirmed to fail against their respective reverts.

## CRAP regressions found and fixed (behavior-preserving extraction, hardener's own domain)

Scoped `node scripts/crapReport.js` to this module's 7 files (targeted
`--coverage` run over just `boyScoutScan.test.js`, not the full suite, given
host load) and found 3 functions over threshold — none flagged in the
architect's own evidence file, which does not mention CRAP at all (that
verification is this stage's job per the hardener role, not the
architect's):

- `parsers.ts::parseBounceRecords` — complexity 7, 100% coverage, CRAP 7.00.
  A pure complexity problem, not a coverage gap. Extracted the per-line
  parse/validate/build into its own `parseBounceLine` helper — same
  "extract to isolate CRAP" pattern already applied to BL-1010's
  `readSwarmIdentityValue` earlier this session. Both resulting functions
  now measure at CRAP 6.00 and 3.00. Re-verified gap-2 above (the OR-guard
  mutants) still killed post-split, both directions.
- `report.ts::renderReport` — complexity 6, 91% coverage, CRAP 6.02. Not a
  complexity problem: the per-source report loop is
  `if (!available) / else if (count === 0) / else`, and no existing test
  anywhere ever hit the plain `else` branch (a source that WAS consulted
  and found real signal) — the "clean" test uses count 0 everywhere, the
  "unavailable" test uses `available: false`, and every other `renderReport`
  call passes an empty `consulted` array. Added one direct unit test hitting
  that branch; coverage went to 100%, CRAP to 6.00 (fixed by coverage alone,
  no extraction needed).
- `readers.ts::readDuplicationReport` — complexity 4, 0% coverage (nothing
  in the automated suite calls the DEFAULT readers at all — they shell out
  to real `npx jscpd`/`node crapReport.js`, and every test injects its own
  fake `SourceReaders` instead, matching this module's own design note on
  why readers stay real-IO rather than mocked), CRAP 20.00. Also noticed
  `readCrapReport` had the IDENTICAL try/catch shape
  (`catch (err) { const e = err as {stdout?:string}; return typeof
  e.stdout === 'string' ? e.stdout : ''; }`) — a duplication `jscpd` itself
  would flag, and each site's own try/catch was also what pushed its
  complexity high enough to matter at 0% coverage. Extracted the shared,
  PURE interpretation logic into `stdoutOrEmptyOnError(run)` — this is
  itself directly unit-testable with no subprocess involved (100% coverage,
  CRAP 3.00), and reduced both exec-wrapping functions to a single `if`
  each. `readDuplicationReport` now measures complexity 2, CRAP 6.00 (not
  flagged); `readCrapReport` was already fine and improved further (CRAP
  2.03). Did NOT add a mocked unit test for `stdoutOrEmptyOnError`'s own
  logic this pass, since 100% coverage was already reached incidentally
  through existing exercised paths — noted as a candidate for a future pass
  if the module grows more exec-wrapping call sites.

Full module re-scan after both fixes:
`node scripts/crapReport.js` over all 7 files exits 0, every function ≤6.00.

## DRY

`npx jscpd --config .jscpd.json src/tools/boyScoutScan` (scoped, not the
full `src/` tree given host load): 0 clones — including after the
`stdoutOrEmptyOnError` extraction removed the one real duplication jscpd's
own threshold hadn't caught (7 lines is below its default clone-length
floor, which is exactly why it went unflagged by the tool and was only
caught by CRAP's independent complexity signal).

## Dependency gate and standing whole-tree guards

- `node extension/out/tools/dependency-gate.js` over the touched files →
  PASSED, no forbidden edges (unchanged by this pass's extractions).
- Parcel touches `specs/pipeline/steps/` (new
  `bl1014BoyScoutScanRanksDebtSteps.js` + `index.js` registration) and
  `extension/test/`. Ran all 11 guard test files: 9/11 clean. The 2 failing
  (`tempDirTrapGuard`, `tmuxReaperGuard`) are the SAME two pre-existing
  failures flagged repeatedly this session on BL-1010/BL-1011 — now
  actually ticketed as BL-1032/BL-1033 per QA's BL-1010 merge-up broadcast
  received just before this parcel. Confirmed still outside this parcel's
  changed-file set; not re-litigated.

## Step-handler review (BL-908 shape-vs-value lookup check)

The acceptance step file resolves every Outline column (`<source>`) through
an explicit `KNOWN_SOURCES` set and a `withSignal` switch keyed on the
literal source name, never by scenario shape — no gap of the BL-908 class.
Fixture lifetime: every scenario creates its temp root and releases it
within a single step's try/finally (`makeRoot`/`cleanup`) — no cross-step
leak of the BL-921/BL-931 class.

## What was NOT run this pass, and why

- BL-113 Gherkin mutation for this feature's one Scenario Outline
  (`boy-scout-scan-02`, 5 examples) — deferred to the next quiet host pass;
  load was still 15–46 on 4 cores (4–11x cores) at the point this pass
  otherwise concluded. First deferral for this ticket.
- A mocked unit test for `stdoutOrEmptyOnError` itself — not needed this
  pass (100% coverage already reached), noted above as a candidate if the
  module grows more call sites needing it directly tested in isolation.
- The stale `required_wiring` entry the architect flagged (still pointing at
  the pre-split `boyScoutScan.ts` path) — confirmed still unedited in
  `backlog/active/BL-1014-*.yaml` as of this pass; not this stage's to
  fix (Article 1.2, specifier territory), and the architect's note is
  already routed. Flagging again here only so the documenter/QA stage knows
  this pre-QA-gate risk is still live, not newly introduced.

## Verification re-run live

- `npm run compile` (from `extension/`) → clean throughout (recompiled
  after every restore in this pass).
- `npx vitest run test/boyScoutScan.test.js` → **24/24** (was 18/18 at the
  architect's pass; +6 new hardening tests).
- `npx vitest run --config vitest.properties.config.mjs test/boyScoutScan.property.test.js`
  → **2/2**, unaffected by the extractions.
- `node specs/pipeline/cli.js specs/features/BL-1014-the-boy-scout-scan-ranks-debt-by-what-it-keeps-costing.feature`
  → **10/10**.

— By hardener.
