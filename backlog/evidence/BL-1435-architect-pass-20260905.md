# BL-1435 — architect pass, 2026-09-05

Ticket: BL-1435-a-rev-parse-root-is-a-live-read
Role: architect
Commit reviewed: d30683594e (cleaner NONE pass)

This is the guard-widening follow-up I reviewed the premise for earlier
today, during BL-1212's own review (the specifier retired BL-1212's
scenario 02 and minted this ticket to carry it forward, RETIRE-WITH per
BL-1006).

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.`
- **Co-change report**: nothing suspicious.
- **jscpd**, independently re-run on the touched/new files: `0 clones`.
- **Register check**: neither `backlog/standing-reds.tsv` nor
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` names this
  file family.

## Invariants Review (BL-633/654) — re-verified live, not just trusted

1. **"One notion of a live root: the rev-parse idiom and the path.join
   idiom are recognized by the same detection... no second scanner"** —
   read `REV_PARSE_TOPLEVEL_SRC` directly: folded into both
   `LIVE_ROOT_BINDING_RE` (named form) and `LIVE_ROOT_INLINE_SRC` (inline
   form) as one alternation each; `growthPatternsFor` and `EXEMPTION_RE`
   are byte-identical to before (confirmed via `git diff`, untouched) —
   both idioms feed the exact same downstream rules by construction.
2. **"The guard's clean verdict is never vacuous... every file... is
   inspected"** — ran `findLiveRepoDerivations('extension/test')` myself:
   returns `[]`. Independently verified all five files
   `grep -l show-toplevel extension/test/*.test.js` names at this commit:
   `docsStructureRealTree.test.js`'s rev-parse call targets `__dirname`
   (confirmed via `grep`) and already carries a real, reasoned exemption
   (BL-1212's); `bl1300HeadroomProofIsPinned.test.js` also binds via
   `__dirname` but only hands the root to `path.join` and a bash-script
   `spawnSync` — no currently-defined growth pattern matches (this
   ticket's own explicit out-of-scope boundary: "which growth operations
   count" stays BL-1038's, untouched); `gitEnvGuard.test.js`'s rev-parse
   calls target `target`/`decoy` fixture roots, never `__dirname`
   (confirmed via `grep`) — correctly outside this widening's own
   `__dirname` tell, BL-1039's fixture-git class; `activePoolFreshnessAudit.test.js`
   and `swarmMetricsCli.test.js` only mention `show-toplevel` inside
   comments, no actual rev-parse call in either.
3. **"Widening detection removes no coverage and adds no bare
   exemptions"** — confirmed no new `BL-1038-EXEMPT:` marker was added by
   this parcel (`docsStructureRealTree.test.js`'s exemption predates this
   ticket, landed by BL-1212); the four other files needed nothing because
   they either read no growth surface or don't bind the live root at all.

## Independently confirmed non-vacuity myself (not just trusted)

Backed up `liveRepoDerivationGuard.js`, mutated `REV_PARSE_TOPLEVEL_SRC`
to a pattern matching nothing (`(?!x)x`), reran the guard's unit test:
**4 of 5 new tests failed immediately** — the inline-form test, the
bare-marker test, and both call-shape assertions inside the
execSync/spawnSync test — matching the coder's own claimed non-vacuity
result exactly. Restored the file, confirmed byte-identical via `diff`
and `git status --short` (empty), reran — 24/24 again.

## Independently re-verified the substance

- `npx vitest run test/liveRepoDerivationGuard.test.js` — **24/24 pass**
  (19 original + 5 new).
- `npx vitest run test/{docsStructureRealTree,bl1300HeadroomProofIsPinned,gitEnvGuard,activePoolFreshnessAudit,swarmMetricsCli}.test.js`
  — **103/103 pass** in my own run, because I ran this batch together
  with `liveRepoDerivationGuard.test.js` in the same command (24 + 79 =
  103) — which explains, and confirms, the cleaner's own arithmetic catch
  in its evidence file: the five regression files ALONE are 79, not 103
  as the coder's evidence table states. Re-ran the five alone to confirm:
  matches the cleaner's 79/79 exactly. A wrong total in the coder's own
  evidence prose, not a functional defect — every individual test
  genuinely passes, independently confirmed by both the cleaner and me.
- `node specs/pipeline/cli.js
  specs/features/BL-1435-a-rev-parse-root-is-a-live-read.feature` —
  **6/6 pass**.
- `node specs/pipeline/cli.js
  specs/features/BL-1038-unit-tests-pin-the-repo-they-derive-from.feature`
  (regression) — **8/8 pass**.
- `node specs/pipeline/cli.js
  specs/features/BL-1212-real-tree-docs-gate-records-its-live-read-exemption.feature`
  (regression) — **2/2 pass**.

## required_wiring

- `extension/test/helpers/liveRepoDerivationGuard.js::show-toplevel` —
  present, confirmed by `grep -c show-toplevel` non-zero and by every
  test above.
- `specs/pipeline/steps/bl1435RevParseRootIsALiveReadSteps.js::registerSteps` —
  present, discovered by directory scan (BL-1371), confirmed by the
  acceptance run passing 6/6.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect found. The cleaner's evidence-accuracy
discrepancy note (a wrong total in the coder's own evidence prose,
correctly judged non-blocking since every underlying test genuinely
passes) is independently confirmed correct. Forwarding to hardener.
