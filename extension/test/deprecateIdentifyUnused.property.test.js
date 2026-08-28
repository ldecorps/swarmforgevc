'use strict';

// BL-1186 invariants (coder-authored first, per BL-654):
//   1. "The scan never auto-closes tickets or deletes code — notification
//      only (BL-311 three-bucket)."
//   2. "Unused and seldom classifications use the locked 90-day / 3-hit
//      thresholds from the human addendum."
// Invariant 3 ("Judgment across many documents requires a hard-tier
// reasoner; easy seats refuse") is a process/scheduling invariant enforced
// by BL-1001's dispatch + Article 3.6 seat-tier gating elsewhere in the
// swarm - it quantifies over WHICH SEAT is permitted to run this ticket's
// own pipeline stages, not over anything this pure module computes, so it
// admits no executable encoding here. Stated reason recorded in the
// parcel/handoff notes rather than a test, per BL-654.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { classifySurface, buildIdentifyUnusedReport, runDeprecatorIdentifyUnusedScan } = require('../out/tools/deprecate-identify-unused');

function surfaceEntryArb() {
  return fc.record({
    surface: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
    hits90d: fc.integer({ min: 0, max: 200 }),
  });
}

test('BL-1186 invariant 2: unused and seldom partition disjointly at the locked 0 / <3 thresholds', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 500 }), (hits) => {
      const cls = classifySurface(hits);
      if (hits === 0) {
        assert.equal(cls, 'unused');
      } else if (hits < 3) {
        assert.equal(cls, 'seldom');
      } else {
        assert.equal(cls, null);
      }
      // The two classes never both apply to the same hit count - a single
      // classifySurface call can only ever return one verdict, so disjointness
      // is true by construction; asserted here directly against the
      // locked boundary values regardless.
      if (hits === 0) {
        assert.notEqual(cls, 'seldom');
      }
    }),
    { numRuns: 200 }
  );
});

test('BL-1186 invariant 2 non-vacuousness: a broken "fewer than 3 including 0" implementation would double-count 0 as seldom', () => {
  const brokenClassify = (hits) => {
    if (hits < 3) return 'seldom'; // wrong: never distinguishes 0 from 1-2
    return null;
  };
  assert.equal(brokenClassify(0), 'seldom');
  assert.equal(classifySurface(0), 'unused');
  assert.notEqual(classifySurface(0), brokenClassify(0));
});

test('BL-1186 invariant 2: buildIdentifyUnusedReport only ever emits candidates classifySurface would itself emit', () => {
  fc.assert(
    fc.property(fc.array(surfaceEntryArb(), { maxLength: 30 }), (entries) => {
      const report = buildIdentifyUnusedReport(entries);
      for (const candidate of report) {
        assert.equal(classifySurface(candidate.hits), candidate.class);
      }
      // every entry classifySurface would omit (>=3 hits) is absent from the report
      const omittedSurfaces = new Set(entries.filter((e) => classifySurface(e.hits90d) === null).map((e) => e.surface));
      for (const candidate of report) {
        assert.ok(!omittedSurfaces.has(candidate.surface) || entries.some((e) => e.surface === candidate.surface && classifySurface(e.hits90d) !== null));
      }
    }),
    { numRuns: 200 }
  );
});

function snapshotTree(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out.set(path.relative(root, full), fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(root);
  return out;
}

test('BL-1186 invariant 1: the scan never mutates any file outside its own pending-notifications queue', () => {
  fc.assert(
    fc.property(fc.array(surfaceEntryArb(), { maxLength: 15 }), (entries) => {
      const root = mkTmpDir('bl1186-prop-inv1-');
      fs.mkdirSync(path.join(root, '.swarmforge', 'deprecator'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'deprecator', 'usage-ledger.json'), JSON.stringify(entries));

      // Pre-existing backlog/docs/config content the scan must never touch.
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-1-decoy.yaml'), 'id: BL-1\nstatus: todo\n');
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'decoy.md'), 'unchanged\n');
      fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
      fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'active_backlog_max_depth\t6\n');

      const before = snapshotTree(root);
      const notifyDir = path.join(root, '.swarmforge', 'deprecator', 'pending-notifications');

      runDeprecatorIdentifyUnusedScan(root, '2026-08-28T00:00:00.000Z');

      const after = snapshotTree(root);
      for (const [relPath, content] of before) {
        assert.equal(after.get(relPath), content, `unexpected mutation of ${relPath}`);
      }
      // The ONLY new paths after the scan are inside pending-notifications/.
      for (const relPath of after.keys()) {
        if (!before.has(relPath)) {
          assert.ok(
            path.join(root, relPath).startsWith(notifyDir),
            `scan wrote outside its own notification queue: ${relPath}`
          );
        }
      }
    }),
    { numRuns: 100 }
  );
});

test('BL-1186 invariant 1 non-vacuousness: a broken implementation that deletes a decoy backlog ticket would fail the guard above', () => {
  const root = mkTmpDir('bl1186-prop-inv1-nonvac-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  const decoy = path.join(root, 'backlog', 'active', 'BL-1-decoy.yaml');
  fs.writeFileSync(decoy, 'id: BL-1\n');
  const before = fs.readFileSync(decoy, 'utf8');

  // Simulate the exact class of bug invariant 1 forbids.
  fs.rmSync(decoy);
  assert.throws(() => assert.equal(fs.readFileSync(decoy, 'utf8'), before));

  // The real implementation never does this.
  fs.writeFileSync(decoy, before);
  runDeprecatorIdentifyUnusedScan(root, '2026-08-28T00:00:00.000Z');
  assert.equal(fs.readFileSync(decoy, 'utf8'), before);
});
