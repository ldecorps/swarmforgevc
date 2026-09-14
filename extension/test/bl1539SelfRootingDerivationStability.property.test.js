'use strict';

// BL-1539 declared invariant (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   "The derivation's verdict on a file is a function of the file's text
//    alone, never of its size or of process scheduling: the same file
//    yields the same self-rooting decision on every run."
//
// This is the exact shape of the bug this ticket fixed: `grep -q` exits at
// its first match while `sed` is still writing the rest of a large file,
// `sed` dies of SIGPIPE, and under `set -euo pipefail` the guard read that
// as "not self-rooting" - a verdict that depended on how much of the file
// grep had consumed before the kernel scheduled sed's next write, not on
// the file's content. `ready_for_next.bb` (16 377 bytes) was kept 0 of 20
// runs before the fix (backlog/evidence/BL-1538-BL-1541-specifier-unowned-
// red-census-20260911.md §2).
//
// The property: for a synthetic file whose SIZE and whether it carries a
// self-rooting marker are both drawn independently, running the guard's
// derivation R times over that exact file yields the SAME verdict every
// time, and that verdict is TRUE iff the marker was embedded. Filler text
// is drawn from an alphabet ([a-z0-9 ]) that cannot itself spell any of the
// guard's five self-rooting substrings (each needs `!`, `"`, `$`, `(`, `)`
// or `/`), so the expected verdict is known by construction, never by
// re-deriving the guard's own regex here (that would just be a second copy
// of the thing under test, per this ticket's own IR-DRY note).
//
// GENERATOR REACH (BL-654): file size ranges from empty to ~48 KB, well
// past the 16 377-byte file that triggered the bug, at both marker-present
// and marker-absent, and the marker (when present) lands at a random line
// index - the fixpoint below asserts every (size bucket x marker) cell was
// actually drawn, so the property cannot pass by only ever generating small
// files.
//
// Non-vacuity (staged break, restored, run 2026-09-14): dropping
// `run-dispatch-forwarding-args!` from SELF_ROOTING_RE (the pre-fix regex)
// turned this red immediately on a marker=run-dispatch-forwarding-args!
// case. Restored; holds. The other half of the fix - the `grep -q` SIGPIPE
// race - is not staged-broken here: reverting to the pre-fix `grep -qE
// ... 2>/dev/null` form under `bash -x` (this file's own read path) hung a
// subprocess indefinitely in this sandbox rather than failing cleanly, so
// that dimension's non-vacuity proof is scenario 05's real read instead
// (bl998_guard_membership_property_runner.bb, which failed exactly on
// `ready_for_next.bb`/`done_with_current.bb` before this ticket's fix - see
// backlog/evidence/BL-1538-BL-1541-specifier-unowned-red-census-20260911.md
// §2 and this ticket's own reproduction).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { deriveSelfRooting, synthScriptsDir, REAL_SCRIPTS_DIR } = require('../../specs/pipeline/steps/lib/bl1539SelfRootingDerivationLib');

// The guard refuses outright ("derivation broke: no self-rooting script
// found") when a scripts dir carries NO self-rooting script at all - its
// own population floor, scenario 02's real-repo analogue. A sandbox holding
// only a marker-absent probe file would trip that floor for a reason having
// nothing to do with THIS property, so every case anchors one small, really
// self-rooting real file alongside the probe - the probe's own verdict is
// asserted independently of it.
const ANCHOR_SELF_ROOTING_FILE = 'agent_runtime.sh';

// One substring per SELF_ROOTING_RE alternative - matched literally, no
// regex reimplementation needed to know the expected verdict.
const MARKERS = ['run-dispatch!', 'run-dispatch-forwarding-args!', 'dispatch-lib/git-root', 'cd "$SCRIPT_DIR"', 'cd "$(dirname "$0")"'];

const FILLER_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789 '.split('');
// A fixed 60-char line (content varies, length does not) makes the total
// file size a direct, predictable function of line count - so the three
// buckets below can be reached BY CONSTRUCTION rather than left to chance.
const fillerLineArb = fc.array(fc.constantFrom(...FILLER_ALPHABET), { minLength: 60, maxLength: 60 }).map((chars) => chars.join(''));

// Bucket -> line-count range, chosen so the resulting byte size (~61
// bytes/line) lands inside that bucket's threshold (small <4096, medium
// <16384, large up to ~48 KB - well past the 16 377-byte file that
// triggered the bug).
const LINE_COUNT_RANGE = {
  small: [0, 20],
  medium: [70, 190],
  large: [300, 700],
};
const sizeBucketArb = fc.constantFrom('small', 'medium', 'large');
const fillerArb = sizeBucketArb.chain((bucket) => {
  const [minLength, maxLength] = LINE_COUNT_RANGE[bucket];
  return fc.array(fillerLineArb, { minLength, maxLength });
});
const markerArb = fc.constantFrom(...MARKERS);
const hasMarkerArb = fc.boolean();
const positionArb = fc.double({ min: 0, max: 1, noNaN: true });
const repeatsArb = fc.integer({ min: 2, max: 3 });

function buildFileText(filler, hasMarker, marker, position) {
  if (!hasMarker) {
    return filler.join('\n');
  }
  const idx = Math.min(filler.length, Math.floor(position * (filler.length + 1)));
  const lines = filler.slice();
  lines.splice(idx, 0, `probe: ${marker}`);
  return lines.join('\n');
}

test('property (BL-1539 invariant): the self-rooting verdict on a file is a function of its text alone, stable across repeats regardless of size', () => {
  const seenSizeBucket = new Set();
  const seenMarker = new Set();
  try {
    fc.assert(
      fc.property(fillerArb, hasMarkerArb, markerArb, positionArb, repeatsArb, (filler, hasMarker, marker, position, repeats) => {
        const text = buildFileText(filler, hasMarker, marker, position);
        const sizeBucket = text.length < 4096 ? 'small' : text.length < 16384 ? 'medium' : 'large';
        seenSizeBucket.add(sizeBucket);
        seenMarker.add(hasMarker);

        const sandbox = synthScriptsDir('bl1539-prop-');
        try {
          fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, ANCHOR_SELF_ROOTING_FILE), path.join(sandbox, ANCHOR_SELF_ROOTING_FILE));
          const fileName = 'probe_target.sh';
          fs.writeFileSync(path.join(sandbox, fileName), text);
          const guardPath = path.join(sandbox, 'test', 'test_shell_fixture_dispatch_isolation.sh');

          const verdicts = [];
          for (let i = 0; i < repeats; i += 1) {
            verdicts.push(deriveSelfRooting(guardPath).includes(fileName));
          }

          const expected = hasMarker;
          for (let i = 0; i < verdicts.length; i += 1) {
            assert.equal(
              verdicts[i],
              expected,
              `run ${i + 1}/${repeats}: expected flagged=${expected} (marker=${hasMarker ? marker : 'none'}, size=${text.length}B), got=${verdicts[i]}`
            );
          }
          const distinct = new Set(verdicts);
          assert.equal(distinct.size, 1, `verdict was not stable across ${repeats} runs: ${JSON.stringify(verdicts)} (size=${text.length}B)`);
        } finally {
          fs.rmSync(sandbox, { recursive: true, force: true });
        }
      }),
      { numRuns: 24 }
    );
  } finally {
    // Generator reach, asserted rather than hoped for (BL-654): every size
    // bucket and both marker states must have been drawn, or the property
    // silently tested less than it claims.
    for (const bucket of ['small', 'medium', 'large']) {
      assert.ok(seenSizeBucket.has(bucket), `generator-reach: never generated a "${bucket}" file`);
    }
    for (const hasMarker of [true, false]) {
      assert.ok(seenMarker.has(hasMarker), `generator-reach: never generated hasMarker=${hasMarker}`);
    }
  }
});
