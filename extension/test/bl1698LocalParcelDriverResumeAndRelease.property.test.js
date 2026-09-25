'use strict';

// BL-1698's two declared invariants.
//
// Invariant 1 ("After any driver or seat restart, no spec file of any
// parcel the driver has touched is left without write permission once
// the driver's first pass completes"): resume-writable-sweep! is pure
// over the filesystem it's handed - exercised here across a generated
// population of driver records (0-4 seats, each with 0-3 spec files, a
// mix of already-writable and locked-444 files, and some records
// missing :specFiles entirely - the pre-chat-setup escalation shape) and
// asserted every named file ends writable, whatever state it started in
// or how many other records/seats share the sweep.
//
// Invariant 2 ("Every mail a driver seat receives ends in exactly one
// of: a git_handoff after a passing gate, a completion, or a recorded
// hold with a question raised; none stays in process without a driver
// record naming why") quantifies over the real dispatch through real
// git/seat subprocesses for four mail shapes (a ticket git_handoff, a QA
// merge-up note, a non-forwarding reverse copy, any other note) - not a
// pure module a generator can drive. Same disposition BL-1697's own
// invariant 2 recorded: encoded by the acceptance feature's own nine
// scenarios (BL-1698-the-local-parcel-driver-survives-a-restart-releases-its-hold-and-handles-merge-only-mail.feature),
// which run the real driver against a real throwaway checkout for every
// one of the four shapes, never a JS reimplementation of the dispatch.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'local_parcel_driver_lib.bb');
const FIXTURE_PREFIX = 'bl1698-resume-sweep-';

function runSweep(projectRoot) {
  execFileSync('bb', ['-e', `(load-file "${LIB}") (local-parcel-driver-lib/resume-writable-sweep! "${projectRoot}")`]);
}

function isWritable(p) {
  return (fs.statSync(p).mode & 0o200) !== 0;
}

// One record: a seat id, its own set of spec files (built fresh under
// the fixture root), each either already writable or locked 444, and
// whether the record even HAS a :specFiles key at all (a pre-chat-setup
// escalation carries none - the sweep must tolerate that, never throw).
const recordArb = fc.record({
  seatId: fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
  hasSpecFiles: fc.boolean(),
  fileCount: fc.integer({ min: 0, max: 3 }),
  lockedFlags: fc.array(fc.boolean(), { minLength: 0, maxLength: 3 }),
});

test('invariant 1: resume-writable-sweep! restores every named spec file to writable, whatever its starting permission, across any population of driver records', () => {
  fc.assert(
    fc.property(fc.uniqueArray(recordArb, { minLength: 0, maxLength: 4, selector: (r) => r.seatId }), (records) => {
      const root = mkTmpDir(FIXTURE_PREFIX);
      const stateDir = path.join(root, '.swarmforge', 'local-driver');
      fs.mkdirSync(stateDir, { recursive: true });
      try {
        const allSpecFiles = [];
        for (const rec of records) {
          const specFiles = [];
          if (rec.hasSpecFiles) {
            for (let i = 0; i < rec.fileCount; i += 1) {
              const p = path.join(root, `${rec.seatId}-spec-${i}.txt`);
              fs.writeFileSync(p, 'spec content\n');
              const locked = rec.lockedFlags[i % Math.max(rec.lockedFlags.length, 1)] ?? false;
              fs.chmodSync(p, locked ? 0o444 : 0o644);
              specFiles.push(p);
              allSpecFiles.push(p);
            }
          }
          const state = rec.hasSpecFiles ? { ticket: 'BL-9', specFiles } : { escalated: true, ticket: 'BL-9', reason: 'x' };
          fs.writeFileSync(path.join(stateDir, `${rec.seatId}.json`), JSON.stringify(state));
        }

        // Never throws, whatever mix of records-with and records-without
        // :specFiles is present (the non-vacuity check below proves a
        // regression here would be caught).
        runSweep(root);

        for (const p of allSpecFiles) {
          assert.ok(isWritable(p), `expected ${p} to be writable after the sweep`);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 30 }
  );
});

test('non-vacuous: a record with no driver-record file at all is untouched by the sweep (proves the sweep reads records, not just chmods everything in sight)', () => {
  const root = mkTmpDir(FIXTURE_PREFIX);
  const stateDir = path.join(root, '.swarmforge', 'local-driver');
  fs.mkdirSync(stateDir, { recursive: true });
  try {
    const unrecorded = path.join(root, 'not-in-any-record.txt');
    fs.writeFileSync(unrecorded, 'x\n');
    fs.chmodSync(unrecorded, 0o444);
    runSweep(root);
    assert.equal(isWritable(unrecorded), false, 'expected an unrecorded file to stay untouched by the sweep');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
