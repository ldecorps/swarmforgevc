# The property-lane node:test import drain (BL-1206)

## The problem this fixes

Fourteen `extension/test/*.property.test.js` files imported `test` from
`node:test` instead of relying on Vitest's `globals: true`
(`vitest.properties.config.mjs` includes `test/**/*.property.test.js` and
sets `globals: true`). A file that imports `test` from `node:test`
registers with node:test's own runner, which Vitest's collector cannot
see — reproduced on `test/alertTelemetry.property.test.js`: node:test
executed every case and printed TAP `ok`, and in the same run Vitest
reported `Error: No test suite found in file ...` and failed the file. The
assertions passed and the file failed simultaneously, so the property lane
gated nothing for any of these fourteen.

BL-1175 met this under time pressure (a stuck BL-605 parcel) and chose the
standing allowlist over the repair — the right call at the time. But
BL-1175 landed and closed, so all of its allowlist rows kept reading
"pre-existing; tracked under BL-1175 pending fix" against a ticket that no
longer existed to fix anything. An allowlist that outlives its own ticket
stops being a deferral and becomes the permanent state — exactly the class
the standing-red rule (BL-1428) exists to catch.

## What changed

The `node:test` import is deleted from each of the fourteen files (all
used plain `test(name, fn)` — no subtests, no node:test-specific options —
so this was a one-line deletion per file, never a rewrite;
`require('node:assert/strict')` is runner-agnostic and stayed). Each
converted file was then run under the real property lane, and the RESULT
decided its allowlist row, not a forced outcome:

- A file that passed once collected leaves
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` entirely.
- A file that fails on its own merits after conversion stays allowlisted,
  with its rationale rewritten to the REAL reason — never left reading
  "pending fix" against a closed ticket, and never forced green under
  pressure the way the original 27-row allowlist was written.

**A file leaves the allowlist only by passing under the property lane,
never by being deleted from the list while still red** (invariant 2) —
`extension/test/helpers/allowlistRemovalGuard.js`'s `findSilentRemovals`
is the pure check this ticket's own acceptance scenarios use to prove it:
given the allowlist's file set before and after, and whether each
departed file actually passed when last measured, it reports any
departure NOT backed by a recorded pass.

At the end of this parcel, `property_suite_standing_allowlist.tsv` holds
exactly one row: `test/hostActivityFeed.property.test.js`, left alone
because its own defect (no test registration at all, not a `node:test`
import — a mis-attribution the architect caught during this parcel's own
review) is a different cause, out of scope here and named in this
ticket's own acceptance scenario so a wholesale drain of the file would
be caught. That row was itself cleared shortly after, and the
mis-attribution corrected, by BL-1434 (2026-09-05): the file was a bare
node script with no `test`/`it`/`describe` registration at all, so Vitest
collected it and reported "no suite found" — a different failure shape
from every `node:test`-import file this ticket converts. BL-1434
registered its forty trials as `test(...)` calls and removed the
register/allowlist rows in the same commit, per the standing-red rule.

## The standing guard

`extension/test/bl1206PropertyLaneNodeTestImportGuard.test.js` is the
property lane's own analog of [BL-1220's unit-lane guard](BL-1220-unit-lane-node-test-import-guard.md):
it walks `extension/test/helpers/nodeTestImportGuard.js`'s
`findPropertyLaneNodeTestImports` (extended with `isPropertyLaneTestFile`
to scope the walk to `*.property.test.js` only) and fails if any
property-lane file imports from `node:test` again — anchored on the
import form at the start of a line, the same self-referential-grep-safe
shape BL-1220's guard already established, reused rather than
reimplemented. `findNodeTestImportLines` itself is BL-1220's own function,
already proven data-vs-import-safe by its own 400-run property test — not
re-proven here.

Like BL-1220's guard, this one carries **no allowlist parameter or skip
path** — an allowlist is exactly how this defect went invisible in the
property lane the first time (BL-1175's own standing-red allowlist
absorbed it with a "pending fix" rationale that outlived its ticket).

## What to do when you see it

A red `bl1206PropertyLaneNodeTestImportGuard.test.js` means a
`*.property.test.js` file imports from `node:test`. Delete the import —
Vitest's `globals: true` supplies the same bindings under
`vitest.properties.config.mjs`. If deleting it reveals a genuine assertion
failure, that is a separate finding: add or update the file's own
`property_suite_standing_allowlist.tsv` row naming the real reason, per
invariant 2 above — never re-add the `node:test` import to make the guard
quiet again.

## Verify

```bash
cd extension && npx vitest run test/bl1206PropertyLaneNodeTestImportGuard.test.js \
  test/bl1206PropertyLaneAllowlistInvariants.property.test.js
grep -l "require('node:test')" extension/test/*.property.test.js
bash swarmforge/scripts/test/test_property_suite_drift_guard.sh
```
The first `grep` should return nothing.

Acceptance:
`specs/features/BL-1206-drain-the-node-test-import-entries-from-the-property-allowlist.feature`.

## Related

- [BL-1220 unit-lane node:test import guard](BL-1220-unit-lane-node-test-import-guard.md) —
  the sibling guard for `*.test.js` files; this ticket is its property-lane
  twin, landed independently.
- [BL-1175 standing property reds do not block unrelated green commits](BL-1175-property-suite-standing-reds-block-unrelated-commits.md) —
  the allowlist mechanism this ticket drains rows from.
- BL-1428 — the standing-red register and rule that reclassified this
  ticket's severity to high after BL-1175 closed with the deferral still
  outstanding.
