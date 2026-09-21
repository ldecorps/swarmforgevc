'use strict';

// BL-1467's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  No bookkeeping commit for a ticket other than the one
//                landed is lost silently by a re-point: every commit
//                reachable from the old tip and not from origin/main is
//                either on the new tip or named in the re-point log and
//                the publish output as dropped, with its reason.
//   invariant 2  BL-1438 stands: the re-point's guards are unchanged, a
//                skip never fails a land, it runs once per land after
//                LAND_PUBLISHED, and the worktree it leaves is clean.
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb (post-land-repoint!)
// against real git fixtures - never a JavaScript restatement of the
// classification, the reset, or the cherry-pick replay.
//
// GENERATOR REACH (reached by construction, never by draw). Invariant 1
// needs every classification OUTCOME reached at least once in the SAME
// walk: a keepable bookkeeping commit for another ticket, an unrelated
// commit, a revert, and a commit for the LANDED ticket itself (dropped as
// redundant) - a generator that only ever produced keepable commits would
// prove nothing about the drop half of "every commit is accounted for".
// Invariant 2 needs the worktree-cleanliness promise checked across BOTH
// a repoint that keeps something and one where a kept candidate conflicts
// (the only path with extra git plumbing - abort, then continue) - a
// generator that never produced a conflict would prove nothing about the
// abort path leaving a clean tree.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1467-property-';
const LANDED = 'BL-9678';

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}

function gitOut(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function head(root) {
  return gitOut(root, 'rev-parse', 'HEAD');
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message);
  return head(root);
}

function initRepo(root) {
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  const excludeFile = path.join(root, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  fs.appendFileSync(excludeFile, '\n.swarmforge/\n');
}

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function libExpr(body) {
  return `(require '[cheshire.core :as json])\n(load-file "${LIB}")\n${body}`;
}

function postLandRepoint(root, landedTaskTicketId) {
  const idForm = landedTaskTicketId ? `"${landedTaskTicketId}"` : 'nil';
  const out = bb(libExpr(
    `(println (json/generate-string (land-step-lib/post-land-repoint! {:root "${root}" :landed-task-ticket-id ${idForm}})))`,
  ));
  return JSON.parse(out.trim().split('\n').pop());
}

// Builds a fixture whose QA-style `main` sits ahead of `origin/main` (an
// independently-built tip-pure commit for LANDED, off the same seed) by
// exactly the commits `spec` describes, each added in order. Returns the
// root and the sha/kind of every local-only commit added, so a property
// can check every one of them against the repoint's own :kept/:dropped.
function buildFixture(spec) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  initRepo(root);
  commitFile(root, 'seed.txt', 'seed\n', 'seed');
  const seed = head(root);

  git(root, 'checkout', '-q', '-b', 'origin-main-line', seed);
  const originMainTip = commitFile(root, `${LANDED}-own.txt`, 'own\n', `${LANDED}: tip-pure replay onto origin/main (BL-1241 land-step remedy)`);
  git(root, 'update-ref', 'refs/remotes/origin/main', originMainTip);
  git(root, 'checkout', '-q', 'main');
  commitFile(root, `${LANDED}-own.txt`, 'own\n', `${LANDED}: own work`);

  const commits = [];
  let n = 0;
  for (const kind of spec) {
    n += 1;
    if (kind === 'bookkeeping') {
      const sha = commitFile(root, `backlog/evidence/BL-9${900 + n}-note.md`, `note ${n}\n`, `BL-9${900 + n}: QA bookkeeping ${n}`);
      commits.push({ kind, sha });
    } else if (kind === 'unrelated') {
      const sha = commitFile(root, `unrelated-${n}.txt`, `x ${n}\n`, `a commit naming no ticket, ${n}`);
      commits.push({ kind, sha });
    } else if (kind === 'revert') {
      fs.writeFileSync(path.join(root, `reverted-${n}.txt`), 'was here\n');
      git(root, 'add', '-A');
      git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `Revert "BL-9${900 + n}: the bounced merge ${n}"`);
      const sha = head(root);
      commits.push({ kind, sha });
    } else if (kind === 'landed-own') {
      const sha = commitFile(root, `${LANDED}-more-${n}.txt`, `more ${n}\n`, `${LANDED}: further own work ${n}`);
      commits.push({ kind, sha });
    } else if (kind === 'conflicting-bookkeeping') {
      // origin/main's own line touches the SAME bookkeeping path with
      // different content, so re-application conflicts.
      git(root, 'checkout', '-q', 'origin-main-line');
      commitFile(root, `backlog/evidence/BL-9${900 + n}-note.md`, `origin version ${n}\n`, `BL-9${900 + n}: note landed a different way ${n}`);
      git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
      git(root, 'checkout', '-q', 'main');
      const sha = commitFile(root, `backlog/evidence/BL-9${900 + n}-note.md`, `qa version ${n}\n`, `BL-9${900 + n}: QA bookkeeping conflicting ${n}`);
      commits.push({ kind, sha });
    } else {
      throw new Error(`unknown commit kind: ${kind}`);
    }
  }

  return { root, commits };
}

const KIND_SHAPES = ['bookkeeping', 'unrelated', 'revert', 'landed-own', 'conflicting-bookkeeping'];

test('BL-1467/BL-654 invariant 1: every local-only commit is accounted for - kept with its content on the new tip, or dropped and named with a reason', { timeout: 120000 }, () => {
  const RUNS = runsPerCell(3 * KIND_SHAPES.length, KIND_SHAPES.length);
  const reach = Object.fromEntries(KIND_SHAPES.map((k) => [k, 0]));

  fc.assert(
    fc.property(
      fc.shuffledSubarray(KIND_SHAPES, { minLength: KIND_SHAPES.length, maxLength: KIND_SHAPES.length }),
      (spec) => {
        for (const k of spec) reach[k] += 1;
        const { root, commits } = buildFixture(spec);
        try {
          const result = postLandRepoint(root, LANDED);
          assert.equal(result.action, 'repointed', `expected :repointed, got: ${JSON.stringify(result)}`);
          const kept = result.kept || [];
          const dropped = result.dropped || [];
          for (const { kind, sha } of commits) {
            const keptEntry = kept.find((k) => k.sha === sha);
            const droppedEntry = dropped.find((d) => d.sha === sha);
            assert.ok(
              (keptEntry && !droppedEntry) || (!keptEntry && droppedEntry),
              `expected ${sha} (${kind}) named as exactly one of kept/dropped, got kept=${JSON.stringify(keptEntry)} dropped=${JSON.stringify(droppedEntry)}`,
            );
            if (kind === 'bookkeeping') {
              assert.ok(keptEntry, `expected a genuine bookkeeping commit kept, got dropped: ${JSON.stringify(droppedEntry)}`);
            } else {
              assert.ok(droppedEntry, `expected a ${kind} commit dropped, got kept: ${JSON.stringify(keptEntry)}`);
              assert.ok(droppedEntry.reason && droppedEntry.reason.length > 0, `expected a non-empty drop reason for ${sha}, got: ${JSON.stringify(droppedEntry)}`);
            }
          }
          // The re-point log carries the same accounting - never only in
          // the returned map.
          const log = fs.readFileSync(path.join(root, '.swarmforge', 'daemon', 'land-repoint.log'), 'utf8');
          for (const { sha } of commits) {
            assert.ok(log.includes(sha), `expected the re-point log to name ${sha}, got: ${log}`);
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    ),
    { numRuns: RUNS },
  );

  assertReachFloor(reach, KIND_SHAPES, RUNS, 'local-only commit kind');
});

test('BL-1467/BL-654 invariant 2: the worktree the re-point leaves is always clean, whether nothing conflicted or something did', { timeout: 60000 }, () => {
  const shapes = [
    { name: 'nothing-to-keep', spec: ['unrelated', 'revert'] },
    { name: 'a-clean-keep', spec: ['bookkeeping'] },
    { name: 'a-conflicting-keep', spec: ['conflicting-bookkeeping'] },
    { name: 'mixed-clean-and-conflict', spec: ['bookkeeping', 'conflicting-bookkeeping', 'unrelated'] },
  ];
  const RUNS = runsPerCell(3 * shapes.length, shapes.length);
  const reach = Object.fromEntries(shapes.map((s) => [s.name, 0]));

  for (const { name, spec } of shapes) {
    fc.assert(
      fc.property(fc.constant(spec), (s) => {
        reach[name] += 1;
        const { root } = buildFixture(s);
        try {
          const result = postLandRepoint(root, LANDED);
          assert.equal(result.action, 'repointed', `expected :repointed, got: ${JSON.stringify(result)}`);
          const status = gitOut(root, 'status', '--porcelain');
          assert.equal(status, '', `expected a clean worktree for shape ${name}, got: ${status}`);
          assert.equal(gitOut(root, 'rev-parse', 'HEAD'), result['new-tip'], `expected HEAD to equal the reported new-tip for shape ${name}`);
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: RUNS },
    );
  }

  assertReachFloor(reach, shapes.map((s) => s.name), RUNS, 'repoint outcome shape');
});
