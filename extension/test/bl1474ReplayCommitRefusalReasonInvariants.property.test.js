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

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const TRUNCATE_LIMIT = 2000;

function replayCommitRefusalReason(ticketId, indexEmpty, stderr) {
  const input = JSON.stringify({ ticketId, indexEmpty, stderr });
  const res = spawnSync(
    'bb',
    [
      '-e',
      `(require '[cheshire.core :as json])
(load-file "${LIB}")
(let [input (json/parse-string (slurp *in*) true)]
  (print (json/generate-string {:reason (land-step-lib/replay-commit-refusal-reason (:ticketId input) (:indexEmpty input) (:stderr input))})))`,
    ],
    { input, encoding: 'utf8' }
  );
  if (res.status !== 0) {
    throw new Error(`bb failed (status ${res.status}): ${res.stderr}`);
  }
  return JSON.parse(res.stdout).reason;
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

test('property (invariant 1): nothing to commit is reported only when the index is empty, whatever stderr says', () => {
  const seen = new Set();
  fc.assert(
    fc.property(
      fc.constantFrom('BL-9001', 'BL-42', 'GH-7'),
      fc.boolean(),
      stderrCaseArb,
      (ticketId, indexEmpty, { kind, stderr }) => {
        seen.add(`${indexEmpty}:${kind}`);
        const reason = replayCommitRefusalReason(ticketId, indexEmpty, stderr);

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
      }
    ),
    { numRuns: 40 }
  );

  // Reachability floor (BL-654): every declared shape must actually have
  // been generated at least once, on both sides of index-empty where it
  // matters, or a branch could pass unexercised.
  for (const kind of ['empty', 'whitespace-only', 'short', 'short-with-newline', 'at-limit', 'one-over-limit', 'well-over-limit']) {
    assert.ok(
      seen.has(`true:${kind}`) || seen.has(`false:${kind}`),
      `generator never produced stderr kind "${kind}": ${JSON.stringify([...seen])}`
    );
  }
  assert.ok([...seen].some((s) => s.startsWith('true:')), 'generator never exercised the index-empty branch');
  assert.ok([...seen].some((s) => s.startsWith('false:')), 'generator never exercised the non-empty-index branch');
});
