'use strict';

// BL-1339's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A land-approval record has exactly one location, the shared
//                target root, whichever checkout the land step ran from; no
//                second copy is created under a linked worktree.
//   invariant 2  Approval never spreads: a record grants approval only while
//                the source it names is itself approved, and a bounce verdict
//                on file still vetoes (BL-952).
//   invariant 3  An unresolvable shared root writes nothing, reports the
//                record as unwritten, and lets the land succeed.
//
// Every fixture has TWO checkouts. The ticket's own diagnosis is that every
// existing test built ONE root, so writer-root and reader-root were the same
// directory by construction and the defect could not be expressed - a
// single-root property here would repeat exactly that mistake.
//
// This also covers the half the acceptance scenarios cannot: they ask the
// predicate from the main checkout, where the old relative path already
// resolved correctly. The human's ruling (option 2) moved the READ onto the
// shared root so the predicate answers the same FROM THE WORKTREE too, and
// that is asserted here.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LAND_STEP_LIB = path.join(SCRIPTS, 'land_step_lib.bb');
const IS_QA_ANCESTOR = path.join(SCRIPTS, 'is_qa_ancestor.sh');
const FIXTURE_PREFIX = 'bl1339-property-';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function buildFixture() {
  const base = mkTmpDir(FIXTURE_PREFIX);
  const main = path.join(base, 'main');
  fs.mkdirSync(main, { recursive: true });
  git(main, 'init', '-q', '-b', 'main', '.');
  git(main, 'config', 'user.email', 't@t');
  git(main, 'config', 'user.name', 't');
  git(main, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(main, 'seed.txt'), 'seed\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'seed');
  git(main, 'branch', 'swarmforge-QA');
  const approved = git(main, 'rev-parse', 'HEAD');
  const worktree = path.join(base, 'wt-QA');
  git(main, 'worktree', 'add', '-q', '-b', 'qa-work', worktree);
  fs.writeFileSync(path.join(main, 'landed.txt'), 'landed\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'BL-9339: tip-pure replay');
  const landed = git(main, 'rev-parse', 'HEAD').slice(0, 10);
  return { base, main, worktree, approved, landed };
}

function record(cwd, root, { commit, source, ticket }) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string (land-step-lib/record-land-approval!
  {:root "${root}" :commit "${commit}" :source "${source}" :task-ticket-id "${ticket}"})))`;
  const r = spawnSync('bb', ['-e', program], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function storeLines(root) {
  const dir = path.join(root, '.swarmforge', 'land-approvals');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean));
}

function askPredicate(cwd, sha) {
  const r = spawnSync('bash', [IS_QA_ANCESTOR, sha], { cwd, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

test('BL-1339/BL-654 invariant 1: one location, whichever checkout the land ran from', () => {
  const reach = { fromMain: 0, fromWorktree: 0 };

  // The checkout is ENUMERATED - it is the whole axis of the defect, so it is
  // never left to a draw. Only the ticket id and shas vary.
  for (const from of ['main', 'worktree']) {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...'0123456789abcdef'), { minLength: 10, maxLength: 10 }).map((cs) => cs.join('')), (sha) => {
        const fx = buildFixture();
        try {
          reach[from === 'main' ? 'fromMain' : 'fromWorktree'] += 1;
          const cwd = fx[from];
          const result = record(cwd, cwd, { commit: sha, source: fx.approved, ticket: 'BL-9339' });
          assert.equal(result['ok?'], true, `the record was not written: ${JSON.stringify(result)}`);

          assert.equal(storeLines(fx.main).length, 1, 'the shared root does not hold exactly one record');
          assert.deepEqual(storeLines(fx.worktree), [], 'a second copy was created under the linked worktree');
          // And the file the recorder REPORTS is the shared one, so a reader
          // following that path finds it.
          assert.ok(
            String(result.file).startsWith(fx.main),
            `the record was reported at ${result.file}, outside the shared root`,
          );
          return true;
        } finally {
          fs.rmSync(fx.base, { recursive: true, force: true });
        }
      }),
      { numRuns: 2 },
    );
  }

  assert.ok(reach.fromMain > 0, 'never landed from the main checkout');
  assert.ok(reach.fromWorktree > 0, 'never landed from the linked worktree - the defect corner went untested');
});

test('BL-1339/BL-654 invariant 2: the predicate agrees from either checkout, and a bounce still vetoes', () => {
  const reach = { asked: 0, vetoed: 0 };

  // The read side of the human's ruling (option 2): the predicate answers the
  // same wherever it is asked from. The acceptance scenarios ask only from the
  // main checkout, where the old relative path already worked - so this is the
  // half only a two-checkout property can see.
  for (const askFrom of ['main', 'worktree']) {
    fc.assert(
      fc.property(fc.constantFrom('BL-9339', 'BL-9340'), (ticket) => {
        const fx = buildFixture();
        try {
          reach.asked += 1;
          const result = record(fx.worktree, fx.worktree, {
            commit: fx.landed,
            source: fx.approved,
            ticket,
          });
          assert.equal(result['ok?'], true);

          const approved = askPredicate(fx[askFrom], fx.landed);
          assert.equal(
            approved.status,
            0,
            `the predicate did not approve the landed replay when asked from ${askFrom}:\n${approved.out}`,
          );

          // BL-952's sequence: approve, land, THEN bounce. The record must
          // stop granting.
          const bounceDir = path.join(fx.main, '.swarmforge', 'bounces');
          fs.mkdirSync(bounceDir, { recursive: true });
          fs.writeFileSync(
            path.join(bounceDir, '2026-09.jsonl'),
            `${JSON.stringify({ at: '2026-09-03T00:00:00Z', commit: fx.approved.slice(0, 10), ticket })}\n`,
          );
          const afterBounce = askPredicate(fx.main, fx.landed);
          assert.notEqual(afterBounce.status, 0, `a bounced source was still approved:\n${afterBounce.out}`);
          reach.vetoed += 1;
          return true;
        } finally {
          fs.rmSync(fx.base, { recursive: true, force: true });
        }
      }),
      { numRuns: 2 },
    );
  }

  assert.ok(reach.asked > 0, 'never asked the predicate');
  assert.ok(reach.vetoed > 0, 'never exercised the bounce veto - approval could be spreading unchecked');
});

test('BL-1339/BL-654 invariant 3: an unresolvable root writes nothing, says so, and does not kill the land', () => {
  fc.assert(
    fc.property(fc.array(fc.constantFrom(...'0123456789abcdef'), { minLength: 10, maxLength: 10 }).map((cs) => cs.join('')), (sha) => {
      const fx = buildFixture();
      const outside = mkTmpDir(`${FIXTURE_PREFIX}outside-`);
      try {
        // A root that is not a repository at all: git cannot answer, so the
        // shared root is unresolvable.
        const result = record(outside, outside, { commit: sha, source: fx.approved, ticket: 'BL-9339' });

        assert.equal(result['ok?'], false, 'the recorder claimed success with no resolvable root');
        assert.ok(result.reason, 'an unrecorded land must say why');
        // Never a guessed path - the silent fallback to the caller's directory
        // is exactly this defect.
        assert.deepEqual(storeLines(outside), [], 'a record was written at the unresolvable root');
        assert.deepEqual(storeLines(fx.main), [], 'a record leaked into an unrelated root');
        assert.deepEqual(storeLines(fx.worktree), []);
        return true;
      } finally {
        fs.rmSync(fx.base, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
      }
    }),
    { numRuns: 3 },
  );
});
