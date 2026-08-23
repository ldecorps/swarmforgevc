const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { childPids, childProcesses, defunctChildren } = require('./helpers/childProcesses');
const { buildClosedTicketCorpus, newRepo } = require('./helpers/backlogCorpusFixture');
const { computeMeanTicketTime } = require('../out/metrics/swarmMetrics');

// BL-1066 invariant 3, as declared on the ticket:
//
//   "Every git child this path spawns is reaped; a completed computation
//    leaves no defunct git process behind."
//
// Measured on THIS process's own direct children only (childProcesses.js), so
// the verdict never depends on what else the host is running. The property
// covers the failing paths as well as the happy one - a target that is not a
// repo at all, and a target that does not exist - because an abandoned child
// is likeliest exactly where the computation bails out early.
//
// A note on what could NOT be encoded: the negative control for the DEFUNCT
// arm specifically. Making a real zombie among this process's children means
// blocking SIGCHLD, which libuv does not permit from inside Node - it reaps
// automatically. The detector is therefore proved against a real LIVE child
// (the instrument check below), and the property asserts both that no child
// survives the computation and that none of any that did is defunct.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const corpusSize = () => fc.oneof(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 200, max: 300 }));

const NON_REPO = 'a directory that is not a git repository';
const MISSING = 'a path that does not exist';
const CORPUS = 'a repo with closed tickets';
const TARGET_KINDS = [CORPUS, NON_REPO, MISSING];

function makeTarget(kind, count) {
  if (kind === CORPUS) {
    return buildClosedTicketCorpus(count, { prefix: 'sfvc-bl1066-reap-' });
  }
  if (kind === NON_REPO) {
    const dir = newRepo('sfvc-bl1066-reap-');
    fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
    return dir;
  }
  if (kind === MISSING) {
    return path.join(newRepo('sfvc-bl1066-reap-'), 'no', 'such', 'directory');
  }
  throw new Error(`unknown target kind "${kind}"`);
}

test('instrument check: the child-process detector actually sees a live child of this process', async () => {
  const before = childPids();
  const child = spawn('sleep', ['5']);
  try {
    assert.ok(
      childPids().includes(child.pid),
      'the detector reported no child while one was demonstrably running - it would report "clean" for anything'
    );
    assert.ok(childProcesses().some((c) => c.pid === child.pid && c.state.length > 0));
  } finally {
    child.kill();
    await new Promise((resolve) => child.on('exit', resolve));
  }
  assert.deepEqual(childPids(), before);
});

test('property: a completed computation leaves no surviving or defunct git child, however it ends', () => {
  fc.assert(
    fc.property(fc.constantFrom(...TARGET_KINDS), corpusSize(), (kind, count) => {
      const target = makeTarget(kind, count);
      const before = childPids();

      computeMeanTicketTime(target);

      assert.deepEqual(
        defunctChildren(),
        [],
        `computing against ${kind} left a defunct child: ${JSON.stringify(childProcesses())}`
      );
      assert.deepEqual(
        childPids(),
        before,
        `computing against ${kind} left a surviving child: ${JSON.stringify(childProcesses())}`
      );
    }),
    { numRuns: 12 }
  );
});
