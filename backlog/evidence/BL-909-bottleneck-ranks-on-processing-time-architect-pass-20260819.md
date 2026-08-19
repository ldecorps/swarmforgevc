# BL-909 architect pass — 2026-08-19

## Scope

Received from cleaner as `merge_and_process cleaner 9f080676f7`. Reviewed
commit is `9f080676f7` (coder-authored; cleaner forwarded it unchanged —
`git show --stat 9f080676f7` is the sole commit in the merged range).

Files reviewed (`git show --stat 9f080676f7`):
- `extension/src/metrics/stageDwell.ts` (production: `nameBottleneck`,
  `BottleneckSummary`)
- `extension/test/bl909BottleneckProcessingRankInvariants.property.test.js`
  (new, coder-authored per BL-654)
- `extension/test/stageDwell.test.js` (unit tests widened)
- `specs/pipeline/steps/bl909BottleneckRanksOnProcessingSteps.js` (new
  acceptance step handlers)
- `specs/pipeline/steps/index.js` (registry wiring, one line)

## Checks run (complete inventory, not first-failure-stop)

1. **Two-layer boundary / host-IO-ownership / webview-storage / secrets /
   integrate-not-fork** — not applicable: pure computation change in a
   metrics module (`nameBottleneck`, `stageTotalDwellMs` caller), no
   tile/webview code, no VS Code API, no tmux/process spawn, no
   `.swarmforge/` I/O, no SwarmForge source touched.
2. **Correctness read of the ranking change** — `nameBottleneck` now maps
   each stage to `{ role, processingMs: s.processing.medianMs, totalMs:
   stageTotalDwellMs(...) }`, filters on `processingMs !== null &&
   processingMs > 0`, sorts descending by `processingMs`, and computes
   `multipleOverNext` as `top.processingMs / next.processingMs`. Checked
   the type-predicate soundness: `stageTotalDwellMs(queueWait, processing)`
   returns `null` only when `processing.medianMs === null`
   (`stageDwell.ts:175`) — since the filter already requires
   `processingMs !== null`, `top.totalMs` is guaranteed non-null wherever
   it is read, so the `s is { ...; totalMs: number }` predicate is sound,
   not just asserted. No defect found.
3. **Field-naming contract (delegated choice, invariant 2)** —
   `totalDwellMs` keeps assigning `top.totalMs` (wait+processing, its
   pre-existing meaning) unchanged; the new `processingDwellMs` carries the
   ranking figure. Neither field's assignment changed shape from what a
   reader already expects.
4. **Downstream consumers verified generic, per the commit's own claim** —
   grepped every reader of `BottleneckSummary`/`nameBottleneck`:
   - `extension/src/tools/stage-dwell-report.ts`'s `formatBottleneckLine`
     reads only `.role`/`.multipleOverNext` — untouched, still correct.
   - `--json` output (`printJsonToStdout(result)`) serializes whatever
     fields `BottleneckSummary` carries — `processingDwellMs` reaches JSON
     for free, satisfying the ticket's `qa_e2e_procedure` step 4 with no
     code change.
   - `swarmforge/scripts/handoffd.bb`'s `stage-dwell-briefing-section`
     shells out to the same compiled `stage-dwell-report.js` text path
     (`handoffd.bb:2172`) — same code, same guarantee.
   - `extension/src/bridge/bridgeServer.ts` / `bridgeState.ts`'s
     `/stage-dwell` endpoint passes through `StageDwellReportResult`
     structurally, no hardcoded bottleneck shape.
5. **Declared invariants (2, per the ticket YAML) — Invariants Review**:
   - Invariant 1 ("queue wait can never make a stage the named bottleneck")
     and invariant 2 ("no field named for total dwell carries a
     processing-only value") are both encoded as fast-check property tests
     in `bl909BottleneckProcessingRankInvariants.property.test.js`
     (coder-authored, per BL-654's first-authorship rule).
   - Non-vacuity: the file documents a hand break-then-fix (reverted
     `nameBottleneck` to the pre-BL-909 total-dwell ranking; both
     properties failed immediately; restored) and additionally carries a
     third, non-property test hard-coding the exact human-reported
     regression shape (specifier: huge wait/tiny processing vs hardener:
     small wait/dominant processing) as a concrete non-vacuity check. The
     generator for invariant 1 also self-checks reachability every run
     (`assert.notEqual` on the two rankings' top role before asserting the
     property), so it cannot pass on a case that failed to exercise the
     regression shape.
   - Re-ran independently, all green (below).
6. **Dependency-rule gate (BL-259 hard gate)** — `node
   out/tools/dependency-gate.js src/metrics/stageDwell.ts` (run from
   `extension/`, matching the tool's scan root): `Dependency-rule gate
   PASSED: no forbidden edges.`
7. **Co-change coupling (BL-255)** — ran `co-change-report.js` against all
   5 changed files. One SUSPECTED COUPLING flagged:
   `extension/test/stageDwell.test.js` ↔ `specs/pipeline/steps/index.js`
   (3 co-changes). Judged benign: `index.js` is an append-only step
   registry that co-changes with every ticket that both touches
   `stageDwell.test.js` and adds pipeline steps (the same shape as prior
   passes noting this file's broad baseline coupling) — no hidden
   architectural edge, `index.js` has no logic beyond the `require` list
   plus one array push.
8. **Property-testing pass (own section)** — the only touched pure module
   is `stageDwell.ts`'s `nameBottleneck`, and its property-shaped surface
   (the two declared invariants) is already fully covered by #5. No
   additional undeclared-property gap found; no new property test added,
   none needed.
9. **Scope boundary** — confirmed the two items the ticket explicitly
   marks out of scope (recomputing how queue-wait/processing are measured;
   coordinator) are untouched by the diff.
10. **Acceptance field format (BL-761 contract)** — `acceptance:` in the
    ticket YAML is a single-line pointer (`specs/features/BL-909-...
    .feature`), not a block scalar.

## Tests re-run independently (all green)

- `cd extension && npm run compile` → clean, no errors.
- `npx vitest run --config vitest.properties.config.mjs bl909` → 3/3
  property tests pass (both declared invariants + the non-vacuity
  regression-shape test).
- `npx vitest run test/stageDwell.test.js` → 25/25 pass.
- `npx vitest run test/stageDwellReportCli.test.js` → 15/15 pass
  (including the `--json`/CLI-vs-structured-result parity tests).
- `npx vitest run test/bridgeServer.test.js -t "stage-dwell"` → 2/2
  relevant tests pass.
- `node specs/pipeline/cli.js
  specs/features/BL-909-bottleneck-ranks-on-processing-time.feature` →
  9/9 Gherkin scenarios pass, covering every `qa_e2e_procedure` step in
  the ticket except the live-briefing render (step 5), which is verified
  by inspection at check #4 instead (same CLI, same code path).

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. Clean sweep — items: NONE. Forwarding to hardender.

By architect.
