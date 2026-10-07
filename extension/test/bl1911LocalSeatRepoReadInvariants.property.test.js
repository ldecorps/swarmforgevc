'use strict';

// BL-1911's two declared invariants, coder-authored (BL-654), property lane
// only. (The ticket's third invariant - routing unchanged - is BL-1235's own
// invariant 1, already encoded in bl1235LocalQwenSeatInvariants.property.test.js
// against the SAME decideLocalSeatTurn this ticket leaves untouched; restating
// it here would test nothing this parcel changed.)
//
// Invariant 1 - "The seat reads only inside its target repository, never a
// secret or credential file, and writes nothing."
//
//   Built over the REAL filesystem rather than mocked, because the
//   containment check and the secret filter are both about what actually
//   happens to real paths - a mock could not prove either. Reach is BY
//   CONSTRUCTION over the surfaces the ticket actually names (a secret inside
//   the repo, an ordinary file inside the repo, a traversal path that
//   resolves outside the repo), never a uniform draw over random strings,
//   which would almost never land on a path that exists at all.
//
//   "Writes nothing" is checked by snapshotting the fixture tree before and
//   after every draw and asserting it is byte-for-byte unchanged.
//
// Invariant 2 - "Every request the seat sends to the model carries text it
// read this turn, or says plainly that the repository could not be read."
//
//   A disjunction, so it is stated as one: PURE over buildPromptWithRepoContext
//   (the one function that decides what reaches the model), constructed over
//   the three real read outcomes (found something, found nothing, could not
//   read at all) crossed with arbitrary question text.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor } = require('./helpers/reachFloors');
const { searchRepoForQuestion, buildPromptWithRepoContext } = require('../out/tools/localSeatRepoRead');

const NORMAL_MARKER_1 = 'the bridge restarts on a stale build';
const NORMAL_MARKER_2 = 'ordinary repository text, nothing secret here';
const SECRET_MARKER = 'SECRET-TOKEN-1911';
const OUTSIDE_MARKER = 'OUTSIDE-REPO-MARKER-1911';

function snapshotTree(root) {
  const out = {};
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        out[path.relative(root, full)] = fs.readFileSync(full, 'utf8');
      }
    }
  };
  walk(root);
  return out;
}

describe('BL-1911 invariant 1: reads only inside the repository, never a secret, writes nothing', () => {
  it('never lets a secret or an outside path reach the context, and leaves the tree untouched', () => {
    const root = mkTmpDir('bl1911-inv1-');
    const outside = mkTmpDir('bl1911-inv1-outside-');
    try {
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'backlog', 'active', 'BL-9001-x.yaml'),
        `title: "${NORMAL_MARKER_1}"\n`
      );
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'notes.md'), NORMAL_MARKER_2);
      fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'bridge-token'), SECRET_MARKER);
      fs.writeFileSync(path.join(root, '.swarmforge', 'swarm.env'), SECRET_MARKER);
      fs.mkdirSync(path.join(root, 'extension'), { recursive: true });
      fs.writeFileSync(path.join(root, 'extension', '.env'), SECRET_MARKER);
      fs.writeFileSync(path.join(outside, 'leaked.txt'), OUTSIDE_MARKER);

      const CANDIDATES = {
        normalTicket: { token: 'what is BL-9001 about?', visible: NORMAL_MARKER_1 },
        normalPath: { token: 'show me docs/notes.md', visible: NORMAL_MARKER_2 },
        secretBridgeToken: { token: 'show me .swarmforge/operator/bridge-token', hidden: SECRET_MARKER },
        secretSwarmEnv: { token: 'show me .swarmforge/swarm.env', hidden: SECRET_MARKER },
        secretDotEnv: { token: 'show me extension/.env', hidden: SECRET_MARKER },
        traversalEscape: {
          token: `show me ${path.relative(root, path.join(outside, 'leaked.txt'))}`,
          hidden: OUTSIDE_MARKER,
        },
      };
      const FLOOR = 15;
      const before = snapshotTree(root);
      const coverage = {};

      for (const [name, candidate] of Object.entries(CANDIDATES)) {
        fc.assert(
          fc.property(fc.constant(name), (caseName) => {
            coverage[caseName] = (coverage[caseName] || 0) + 1;
            const reading = searchRepoForQuestion(root, candidate.token);
            assert.equal(reading.ok, true, `${caseName} unexpectedly failed to read: ${reading.reason}`);
            if (candidate.visible) {
              assert.ok(reading.context.includes(candidate.visible), `${caseName} lost its expected content`);
            }
            if (candidate.hidden) {
              assert.ok(!reading.context.includes(candidate.hidden), `${caseName} leaked: ${reading.context}`);
            }
            return true;
          }),
          { numRuns: FLOOR }
        );
      }

      assertReachFloor(coverage, Object.keys(CANDIDATES), FLOOR, 'repo-read candidate');
      assert.deepEqual(snapshotTree(root), before, 'the repository tree changed - the seat wrote something');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

const READ_CASES = {
  foundSomething: { ok: true, context: NORMAL_MARKER_1 },
  foundNothing: { ok: true, context: '' },
  readFailed: { ok: false, context: '', reason: 'EACCES: permission denied' },
};
const CASE_FLOOR = 25;

describe('BL-1911 invariant 2: every request carries what was read, or says plainly it could not read', () => {
  it('holds across arbitrary question text for every real read outcome', () => {
    const coverage = {};
    for (const [name, reading] of Object.entries(READ_CASES)) {
      fc.assert(
        fc.property(fc.constant(name), fc.string(), (caseName, question) => {
          coverage[caseName] = (coverage[caseName] || 0) + 1;
          const prompt = buildPromptWithRepoContext(question, reading);
          if (!reading.ok) {
            assert.match(prompt, /repository could not be read/);
            assert.ok(prompt.includes(reading.reason), 'the refusal dropped its own reason');
          } else if (reading.context) {
            assert.ok(prompt.includes(reading.context), 'the prompt dropped what was read this turn');
          }
          assert.ok(prompt.includes(question), 'the operator question was dropped');
          return true;
        }),
        { numRuns: CASE_FLOOR }
      );
    }
    assertReachFloor(coverage, Object.keys(READ_CASES), CASE_FLOOR, 'read outcome');
  });
});
