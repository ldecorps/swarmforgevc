# BL-923 architect pass — 2026-08-19

## Scope

Received from cleaner as `merge_and_process cleaner ece6da23ce`. Reviewed
commit is `ece6da23ce` (coder-authored; cleaner forwarded it unchanged —
`git show --stat ece6da23ce` is the sole commit in the merged range).

Files reviewed (`git show --stat ece6da23ce`):
- `extension/src/quality/closingCeremony.ts` (production: `eventOccupancyInterval`,
  `sumOccupiedMs`, `computeDwellHotspots`)
- `extension/test/closingCeremony.test.js` (unit tests widened, 31/31)
- `extension/test/closingCeremonyDwellOccupancy.property.test.js` (new,
  coder-authored per BL-654)
- `specs/pipeline/steps/bl923DwellCountsOccupiedTimeSteps.js` (new
  acceptance step handlers)
- `specs/pipeline/steps/index.js` (registry wiring, one line)

## Checks run (complete inventory, not first-failure-stop)

1. **Two-layer boundary / host-IO-ownership / webview-storage / secrets /
   integrate-not-fork** — not applicable: pure computation change in
   `extension/src/quality/closingCeremony.ts`'s dwell fold. No tile/webview
   code, no VS Code API, no tmux/process spawn, no `.swarmforge/` I/O
   (module header itself notes it never touches fs), no SwarmForge source
   touched.
2. **Correctness read of the fold itself** — `eventOccupancyInterval`
   reconstructs `[endMs - processingMs, endMs]` and degrades to `null` on
   an unparseable `at`, matching `stageDwell.ts`'s existing per-item degrade
   convention. `sumOccupiedMs` is a standard sort-by-start, merge-on-overlap
   interval union — verified the merge predicate (`startMs <= mergedEnd`)
   is correct for touching-but-not-overlapping intervals (a shared boundary
   point contributes zero extra length either way, so merging or not there
   is immaterial to the sum).
3. **Negative-`processingMs` edge case, checked and ruled out** — a
   corrupt/negative `processingMs` would invert an interval (`startMs >
   endMs`) and could in principle corrupt an unrelated merge. Traced the
   only producer of `stage-dwell` source events
   (`leanLedgerComposeStageDwell.ts`) back to `deriveOneDwellRecord`
   (`stageDwell.ts:79`), which is gated by `isValidDwellWindow` requiring
   `completedMs >= dequeuedMs` before a record is ever emitted — so
   `processingMs >= 0` is guaranteed by construction for every event this
   fold can see. Not a live defect; no action needed.
4. **Declared invariants (2, per the ticket YAML) — Invariants Review**:
   - Invariant 1 ("a role's dwell total is the time that role was
     occupied... for any batch size") is encoded as two fast-check property
     tests in `closingCeremonyDwellOccupancy.property.test.js`
     (coder-authored, per BL-654's first-authorship rule): a
     by-construction window-plan generator cross-checked against an
     independent 100ms-bucket coverage count, plus a dedicated
     N-identical-windows property. Re-ran independently, both green (below).
   - Invariant 2 ("the per-parcel ledger events are not touched") is
     recorded as non-encodable (quantifies over the diff's own scope, not a
     pure function's input space) per BL-654's carve-out, and is verified
     by diff review: `git show --stat ece6da23ce` touches only
     `closingCeremony.ts` and its tests/steps — `stageDwell.ts`,
     `leanLedger.ts`'s event shape, and `hasLeanLedgerEventShape` are
     absent from the diff. Confirmed myself from the stat output, not
     taken on the commit message's word.
5. **Non-vacuity — independently re-verified, not just read from the
   commit message.** Edited `sumOccupiedMs` locally to the pre-fix plain
   sum (`intervals.reduce((sum, iv) => sum + (iv.endMs - iv.startMs), 0)`),
   rebuilt, and confirmed: 4/31 unit tests fail, both property tests fail
   (the N-identical-windows property fails on its first generated case),
   and 1/5 acceptance scenarios fail (the "two/three parcels sharing one
   window" Outline rows and the ranking scenario). Reverted via `git
   restore` and reconfirmed all four layers green again (below). Working
   tree left clean.
6. **Dependency-rule gate (BL-259 hard gate)** — `node
   out/tools/dependency-gate.js src/quality/closingCeremony.ts` (run from
   `extension/`): `Dependency-rule gate PASSED: no forbidden edges.`
7. **Co-change coupling (BL-255)** — ran `co-change-report.js` against
   `closingCeremony.ts`. Every reported file is at or below 2 co-changes,
   under the tool's default suspected-coupling threshold of 3 — nothing
   flagged.
8. **Property-testing pass (own section)** — the only touched pure module
   is `closingCeremony.ts`'s `computeDwellHotspots`/new helpers, and its
   property-shaped surface (invariant 1) is already fully covered by #4.
   No additional undeclared-property gap found; no new property test
   added, none needed.
9. **Scope boundary** — confirmed the ticket's `out_of_scope` items
   (`queueWaitMs`, per-parcel `processingMs` and everything upstream in
   `stageDwell.ts`, the stall/bounce hypotheses, per-ticket dwell surfaces
   outside the packet) are all untouched by the diff. `stageDwell.ts`'s own
   separate per-role highlight (`nameBottleneck`, median-based) is a
   different statistic for a different consumer and not this ticket's
   invariant's target.
10. **Acceptance field format (BL-761 contract)** — `acceptance:` in the
    ticket YAML is a single-line pointer
    (`specs/features/BL-923-dwell-counts-occupied-time-not-parcel-sum.feature`),
    not a block scalar.

## Tests re-run independently (all green)

- `cd extension && npm run compile` → clean, no errors.
- `npx vitest run test/closingCeremony.test.js` → 31/31 pass.
- `npm run test:properties -- test/closingCeremonyDwellOccupancy.property.test.js`
  → 2/2 property tests pass.
- Drove `specs/pipeline/runnerAdapter.js#runPipeline` directly against
  `specs/features/BL-923-dwell-counts-occupied-time-not-parcel-sum.feature`
  with `specs/pipeline/steps/index.js` → 5/5 Gherkin scenarios pass
  (the 4-row Outline plus the ranking scenario).

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. Clean sweep — items: NONE. Forwarding to hardender.

By architect.
