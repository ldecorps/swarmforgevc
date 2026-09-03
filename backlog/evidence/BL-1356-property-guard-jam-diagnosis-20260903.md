# Property-suite guard jam — diagnosis, 2026-09-03 (specifier)

Investigating the coder's `note`: *"property-suite guard blocked 4 unrelated
commits today on load flakes."* Taken as a report, not a conclusion — the phrase
"load flakes" turned out to describe suite-level ("Failed Suites") failures, but
the cause is neither host load nor a flake.

## What was actually run

`npm run test:properties` from `extension/`, full run to completion,
2026-09-03. Two earlier attempts were killed at the 120s tool ceiling
(`EXIT=143`) and had to be relaunched detached — the same 2-minute trap
BL-1275 records for 2026-08-29. **Result:**

```
Test Files  27 failed | 289 passed (316)
     Tests  17 failed | 878 passed (895)
  Duration  144.76s
```

27 failed files but only 17 failed tests: 17 files failed at suite level
(Vitest's ` FAIL  file [ file ]` shape) and 10 had failing tests.

## The one file that jams the gate

Fed the real run output through the guard's own helpers
(`property_suite_standing_allowlist_lib.sh`):
`ps_suite_extract_failing_files` parses **all 27** — so the BL-1234 extractor
bug is genuinely fixed — and `ps_allowlist_file_is_allowlisted` puts 26 in the
standing allowlist and exactly one outside it:

```
>> BLOCKING  test/bl1323StampOffInvariants.property.test.js
```

`check_property_suite_drift.sh`'s `path_triggers_check` fires on
`extension/src/*` and `*.property.test.js`, so that single file refuses every
such commit, repo-wide, for every role.

## Why it is red

```
FAIL test/bl1323StampOffInvariants.property.test.js >
  BL-1323/BL-654 invariant 2: no green suite writes a decision into the hotfix ledger
AssertionError: the row is no longer stamp-open:
  state: awaiting-human
  stamp_ticket: BL-1323
test/bl1323StampOffInvariants.property.test.js:79
  assert.ok(/state: stamp-open/.test(thisRow), ...)
```

The assertion pins the **current state literal** of its own row in the live
`backlog/hotfix-ledger.yaml`. That row is now `awaiting-human`, which is the
stamp workflow doing exactly what it exists to do. Nothing regressed; the
invariant it defends is intact.

Same shape across the family (`grep -o 'state: [a-z-]*'` over the stamp-off
files): `bl1116` and `bl1117` pin `/state: pending/`, `bl1323` pins
`/state: stamp-open/`. All read the live file — `bl1116` line 19:
`const LEDGER = path.join(REPO, 'backlog', 'hotfix-ledger.yaml')`.

Five of the six are **already** in `property_suite_standing_allowlist.tsv`
(bl1113, bl1115, bl1116, bl1117, bl1136), every one with the same boilerplate
rationale. bl1323 is the sixth instance of one mechanism, not a sixth
unrelated red.

## Immediate unblock (does not wait on the ticket)

As of this pass, `backlog/hotfix-ledger.yaml` carries an **uncommitted**
working-tree edit in the shared master checkout:

```
-  state: stamp-open
+  state: awaiting-human
     stamp_ticket: BL-1323
```

HEAD still reads `stamp-open`, so the red is another role's in-flight edit.
Two steps, in order, and neither is this ticket's:

1. Whoever owns that edit lands it. Reverting it is **not** the fix — the row
   is genuinely past `stamp-open` now.
2. `test/bl1323StampOffInvariants.property.test.js` then needs a
   `property_suite_standing_allowlist.tsv` row until BL-1356 lands, because the
   row will legitimately stay advanced. That waiver belongs to whoever owns the
   gate registry. Cite **BL-1356** in the rationale column rather than the
   boilerplate string the other five carry, so it is removable on sight.

Until one of those happens, `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` is the
only exit — and the guard's own header calls that "recovery-only; never the
standing recipe (BL-1121)". Say so explicitly in any commit message that uses
it, naming bl1323.

## Ticketed

**BL-1356** (`type: defect`, `severity: high`, `backlog/paused/`, commit
`40a9ac7460`) — a stamp-off invariant must fail when, and only when, the run
that executes it changed the row it watches, without weakening the real gate.
`human_approval: pending` with `ruling_options` on whether the gating half keeps
reading the live ledger.

## Not duplicates (checked)

- **BL-1314** (done) — same lesson, different site: `test_pipeline_code_on_main_guard.sh`'s
  BL-925 invariant-2 ancestry grep.
- **BL-1234** (done) — the allowlist extractor. Verified working here: it parsed all 27.
- **BL-1175** — the allowlist mechanism itself, behaving as designed.
- **BL-1275** (paused) — the guard discards the output it refused on. Directly why
  this cost a 145s re-run instead of a glance at a log.
- **BL-1348 / BL-1349** (paused, approved) — lane speed and fork sizing. The lane
  being slow is why nobody re-runs it to check; it is not why it is red.
- **BL-1107** (done) — one file's per-test budget under host load.

The other 26 failing files are already allowlisted, several for unrelated
reasons (`alertTelemetry` fails with `No test suite found in file`, the BL-1249
`node:test` collection shape, tracked by BL-1206).
