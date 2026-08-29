# The unit-lane node:test import guard (BL-1220)

## The problem this fixes

Twenty-four `extension/test/*.test.js` files imported `test` (and in one
case `test.beforeEach`) from `node:test` instead of relying on Vitest's
`globals: true`. Vitest collects nothing from a file that declares its
tests to a different runner — it reports `No test suite found in file`
and moves on — and **nothing in this repository runs `node --test`**:
`npm test` spawns `node_modules/.bin/vitest run` only. So these 24 files'
assertions had not executed since the suite moved to Vitest (BL-124),
while every role reading the tree counted them as coverage. This is worse
than a red: a red test at least runs and fails visibly.

## What changed

The `node:test` import is deleted from each of the 24 files; `test`,
`describe`, `it`, `beforeEach`, etc. now resolve to Vitest's own globals.
No assertion, suite structure, or test style was rewritten beyond that —
`hostActivityFeed.test.js` needed `test.beforeEach` moved to Vitest's
`beforeEach` global (the same runner-binding repair, since `test` no
longer carries a `.beforeEach`).

**A file that does not pass after the import is removed is never
allowlisted, skipped, or deleted to clear the lane.** Ten of the 24 files
also carry BL-1221's separate `deps.checkOrphanedAuthoredDocs is not a
function` defect; they now collect and fail honestly on that instead of
failing to collect at all — an intermediate state this ticket calls out
as expected, not a regression it caused or hid.

## The guard

`extension/test/helpers/nodeTestImportGuard.js` (walked by
`extension/test/nodeTestImportGuard.test.js`, the standing gate) fails
the unit lane if any `test/*.test.js` file (excluding `*.property.test.js`
and `test/fixtures/**`) imports from `node:test` again — anchored on the
import **form** at the start of a line, never the bare string
`node:test`, so a fixture or comment that mentions the string as data is
never a false positive (the self-referential-grep trap: a guard that
greps for its own needle can flag the file describing it).

Deliberately lane-scoped and **without an allowlist parameter or skip
path** — the property lane carries the identical defect in its own 13-15
files (BL-1206, lands independently), and an allowlist is exactly how
that lane's copy of this defect went invisible in the first place
(BL-1175's standing-red allowlist absorbed it with a "pending fix"
rationale). `test/fixtures/**` is exempt because those are pinned task
fixtures the harness runs through a real `node --test` child process,
where importing `node:test` is correct.

## What to do when you see it

A red `nodeTestImportGuard.test.js` means a file under
`extension/test/*.test.js` (not `.property.test.js`, not under
`fixtures/`) imports from `node:test`. Delete the import — Vitest's
`globals: true` supplies the same bindings. If deleting it reveals a
genuine assertion failure, that is a separate finding to report or bounce,
not something to paper over by reintroducing the import or skipping the
file.

## Verify

```bash
cd extension && npx vitest run test/nodeTestImportGuard.test.js \
  test/nodeTestImportGuard.property.test.js
grep -rn "require(.node:test.\|from 'node:test'\|from \"node:test\"" \
  extension/test/*.test.js
```
The grep should return nothing outside `*.property.test.js`.

Acceptance:
`specs/features/BL-1220-main-lane-node-test-imports-leave-assertions-unrun.feature`.
Evidence (per-file before/after counts, full attribution of the remaining
standing red): `backlog/evidence/BL-1220-unit-lane-node-test-imports-20260829.md`.

## Out of scope / separately owned

- The property lane's identical 13-15 files and
  `property_suite_standing_allowlist.tsv` — BL-1206.
- BL-1221's `deps.checkOrphanedAuthoredDocs` stub gap, now visible on ten
  of the 24 repaired files.
- The rest of the standing unit red (ambient `CURSOR_API_KEY` gap, the
  other repo-hygiene guard reds) — separate causes, separately owned.

Related: sibling property-lane guard,
[BL-570 property-suite drift guard](BL-570-property-suite-drift-guard.md);
[BL-1175 standing-red allowlist](BL-1175-property-suite-standing-reds-block-unrelated-commits.md)
(the mechanism this ticket deliberately does not introduce for the unit
lane).
