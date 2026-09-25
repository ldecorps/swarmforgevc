'use strict';

// BL-1474 declared invariants:
//
// 1. The replay's escalate reason is true of the cause: 'nothing to
//    commit' appears only when the scratch index holds no change; any
//    other commit failure carries git's own stderr, or says the commit
//    was refused without text when there was none.
// 2. Nothing else about replay! changes: a successful commit's flow, the
//    passenger guards and the completeness check (BL-1447) are untouched
//    - covered by the existing example-based suites
//    (land_step_lib_test_runner.bb, the BL-1447 acceptance feature), not
//    repeated here as a property (it is a "no regression" statement about
//    unrelated code paths, not a generative property of this ticket's own
//    pure decision function).
//
// Drives the REAL land_step_lib.bb/replay-commit-refusal-reason (a pure
// function - no git calls) via `bb -e`, never a JS reimplementation of its
// branching. Runs ONLY via `npm run test:properties`.
//
// BL-1663: replayCommitRefusalReason() used to start a fresh bb and load
// the whole lib for EVERY draw (40 process starts per test), which cost
// 6-8s alone and timed out the lane's 20s testTimeout under fork
// contention. One bb invocation now maps over every sampled draw in a
// single process; the assertions below are unchanged per draw.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const TRUNCATE_LIMIT = 2000;

function replayCommitRefusalReasons(draws) {
  const input = JSON.stringify(
    draws.map(([ticketId, indexEmpty, { stderr }]) => ({ ticketId, indexEmpty, stderr }))
  );
  const res = spawnSync('bb',
    [
      '-e',
      `(require '[cheshire.core :as json])
(load-file "${LIB}")
(let [inputs (json/parse-string (slurp *in*) true)
      reasons (mapv (fn [{:keys [ticketId indexEmpty stderr]}]
                       (land-step-lib/replay-commit-refusal-reason ticketId indexEmpty stderr))
                     inputs)]
  (print (json/generate-string {:reasons reasons})))`,
    ],
    { input, encoding: 'utf8' }
  );
  if (res.status !== 0) {
    throw new Error(`bb failed (status ${res.status}): ${res.stderr}`);
  }
  return JSON.parse(res.stdout).reasons;
}

function asciiString(minLength, maxLength) {
  return fc
    .array(fc.integer({ min: 33, max: 126 }), { minLength, maxLength })
    .map((codes) => String.fromCharCode(...codes));
}

// One explicit case per shape the pure function branches on, tagged so the
// reachability floor below can prove every branch was actually exercised -
// never left to chance the way an unstructured fc.string() would.
const stderrCaseArb = fc.oneof(
  fc.constant({ kind: 'empty', stderr: '' }),
  fc.constant({ kind: 'whitespace-only', stderr: '   \n\t  ' }),
  asciiString(1, 300).map((s) => ({ kind: 'short', stderr: s })),
  asciiString(1, 300).map((s) => ({ kind: 'short-with-newline', stderr: `${s}\n` })),
  asciiString(TRUNCATE_LIMIT, TRUNCATE_LIMIT).map((s) => ({ kind: 'at-limit', stderr: s })),
  asciiString(TRUNCATE_LIMIT + 1, TRUNCATE_LIMIT + 1).map((s) => ({ kind: 'one-over-limit', stderr: s })),
  asciiString(TRUNCATE_LIMIT + 500, TRUNCATE_LIMIT + 3000).map((s) => ({ kind: 'well-over-limit', stderr: s }))
);

const STDERR_KINDS = ['empty', 'whitespace-only', 'short', 'short-with-newline', 'at-limit', 'one-over-limit', 'well-over-limit'];

// One fixed stderr string per kind (BL-1747): used to build the 14
// constructed (kind x index-empty) cells below, so the reachability floor
// holds by construction rather than by chance over 40 unseeded draws.
function constructedStderrFor(kind) {
  switch (kind) {
    case 'empty':
      return '';
    case 'whitespace-only':
      return '   \n\t  ';
    case 'short':
      return 'x';
    case 'short-with-newline':
      return 'x\n';
    case 'at-limit':
      return 'x'.repeat(TRUNCATE_LIMIT);
    case 'one-over-limit':
      return 'x'.repeat(TRUNCATE_LIMIT + 1);
    case 'well-over-limit':
      return 'x'.repeat(TRUNCATE_LIMIT + 500);
    default:
      throw new Error(`BL-1747: unknown stderr kind "${kind}"`);
  }
}

// 14 cells, one per (kind x index-empty) combination - every declared shape
// on both sides, by construction, independent of what the sampler draws.
function constructedDraws() {
  const draws = [];
  for (const kind of STDERR_KINDS) {
    for (const indexEmpty of [true, false]) {
      draws.push(['BL-9001', indexEmpty, { kind, stderr: constructedStderrFor(kind) }]);
    }
  }
  return draws;
}

test('property (invariant 1): nothing to commit is reported only when the index is empty, whatever stderr says', () => {
  const inputArb = fc.tuple(fc.constantFrom('BL-9001', 'BL-42', 'GH-7'), fc.boolean(), stderrCaseArb);
  const draws = constructedDraws().concat(fc.sample(inputArb, 40));
  const reasons = replayCommitRefusalReasons(draws);

  const seen = new Set();
  draws.forEach(([ticketId, indexEmpty, { kind, stderr }], i) => {
    seen.add(`${indexEmpty}:${kind}`);
    const reason = reasons[i];

    if (indexEmpty) {
      // Index-empty wins outright: even a non-blank stderr must never
      // leak into the reason once the index itself is the true cause.
      assert.equal(
        reason,
        `land-step replay: nothing to commit for ${ticketId} - own-paths identical to origin/main`
      );
      return;
    }

    assert.ok(!reason.includes('nothing to commit'), `a non-empty index must never say "nothing to commit": ${reason}`);
    assert.ok(!reason.includes('own-paths identical to origin/main'), `reason: ${reason}`);

    const trimmed = stderr.trim();
    if (trimmed.length === 0) {
      assert.equal(reason, `land-step replay: commit refused for ${ticketId}, no text`);
      return;
    }

    assert.ok(!reason.includes(', no text'), `non-blank stderr must not be reported as "no text": ${reason}`);
    const prefix = `land-step replay: commit refused for ${ticketId} - `;
    assert.ok(reason.startsWith(prefix), `reason: ${reason}`);
    const body = reason.slice(prefix.length);
    if (trimmed.length > TRUNCATE_LIMIT) {
      assert.equal(body, `${trimmed.slice(0, TRUNCATE_LIMIT)} ... (truncated)`);
    } else {
      assert.equal(body, trimmed, 'stderr at or under the bound must be quoted verbatim, untruncated');
    }
  });

  // Reachability floor (BL-654/BL-1747): every declared shape must have
  // been exercised on BOTH sides of index-empty - guaranteed by the 14
  // constructed cells above, not left to the sampler's chance.
  for (const kind of STDERR_KINDS) {
    assert.ok(seen.has(`true:${kind}`), `generator never produced index-empty stderr kind "${kind}": ${JSON.stringify([...seen])}`);
    assert.ok(seen.has(`false:${kind}`), `generator never produced non-empty-index stderr kind "${kind}": ${JSON.stringify([...seen])}`);
  }
});
