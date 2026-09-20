# Unowned-red sighting: bl1459 (deterministic) + bl1474 (in-suite only), coder@2, 2026-09-20

Sighted running the full property lane once before forwarding BL-1660
(role prompt requirement). Neither file is touched by BL-1660 (which only
edits `swarmforge/scripts/local_ollama_pack_shape_lib.sh`, its shell test
runner, BL-1142's feature/handler, and adds a new, separate property test
file `bl1660PackConfigNoEarlyExit.property.test.js`). Checked
`backlog/standing-reds.tsv`: neither file has a row.

## 1. `test/bl1459DocumenterBriefingTipGuardInvariants.property.test.js` — deterministic, real

Full-lane run: 1 of 4 tests in this file failed. Re-run in isolation
(`npx vitest run --config vitest.properties.config.mjs
test/bl1459DocumenterBriefingTipGuardInvariants.property.test.js`):
same failure, 3 passed / 1 failed — not contention, reproduces every time.

Failing test: `property (BL-1459 invariant 2) non-vacuity: a broken
branch-reachability check would judge every merge, even a non-documenter
one - proven against a scratch copy, then restored` (test.js:200):

```
AssertionError: expected to find the hook-mode branch-reachability check to remove for the non-vacuity probe
- Expected: true
+ Received: false
```

The test hardcodes a literal marker string it expects to find verbatim in
`swarmforge/scripts/check_documenter_briefing_tip.sh`:

```js
const marker = 'if ! git merge-base --is-ancestor "$INCOMING" "$DOCUMENTER_BRANCH" 2>/dev/null; then\n  exit 0\nfi\n';
assert.ok(original.includes(marker), ...);
```

The guard no longer contains that exact shape. What it has now (guard
lines ~217-222, hook-mode branch check):

```bash
DOCUMENTER_BRANCH="$(resolve_documenter_branch || true)"
if [[ -z "$DOCUMENTER_BRANCH" ]]; then
  ...
fi
if ! git merge-base --is-ancestor "$FULL_TIP" "$DOCUMENTER_BRANCH" 2>/dev/null; then
  refuse_direct "$FULL_TIP is not on $DOCUMENTER_BRANCH."
```

Different variable (`$FULL_TIP`, not `$INCOMING`) and a different body
(`refuse_direct ...`, not a bare `exit 0`). This matches the shape the
specifier's memory already names for 2026-09-20: BL-1459's guard was
changed from a plain `merge-base --is-ancestor` check to a first-parent /
branch-membership check (a chain role reaches every upstream commit -
ancestry is not authorship) after this property test was written. The
production fix looks correct on inspection; this specific non-vacuity
probe's embedded literal was never updated to match — a successor-left-red
of the same shape as BL-1428/BL-871/BL-1308 sc03 this same shift (one
test's hardcoded literal outlived the code it was quoting).

Not fixed here: outside BL-1660's domain (this ticket touches only the
local-Ollama pack-shape library/test/feature), and the coder prompt does
not own rewriting another ticket's non-vacuity fixture without that
ticket's own review.

## 2. `test/bl1474ReplayCommitRefusalReasonInvariants.property.test.js` — in-suite only, not deterministic

Full-lane run: `Test timed out in 20000ms` on `property (invariant 1):
nothing to commit is reported only when the index is empty, whatever
stderr says`. Re-run in isolation: passed clean, 6.57s (well under the
20s timeout). This matches the already-diagnosed BL-1633 shape (per-file
gate reads IN-SUITE under fork contention and can time out/refuse a pole
that is fine alone) rather than a new defect - noted here in case the
specifier wants a register row anyway, but not treated as a confirmed red
on its own (single non-repro; isolation run is clean).

## Full-lane run this was sighted in

`cd extension && npm run test:properties` (coder@2 worktree, before the
BL-1660 forward): 429 passed / 2 failed (431 files), 1256 passed / 2
failed (1258 tests), 3 unhandled `[vitest-worker]: Timeout calling
"onTaskUpdate"` errors (BL-871 allowlisted noise, not counted as failures).

By coder.
