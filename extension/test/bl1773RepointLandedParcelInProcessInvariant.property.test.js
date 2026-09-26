'use strict';

// BL-1773's declared invariant (property authorship rests with the coder,
// first pass - BL-654), restated 2026-09-26 over files rather than parcels
// (QA spec gap 003254 - handoffd's claim-progress sidecar sits beside every
// landed parcel at QA land time, because QA commits evidence before it
// lands):
//
//   "The re-point never resets a tree whose in_process holds anything
//    beyond ONE git_handoff naming the landed ticket plus that same file's
//    handoff_lib-registered sidecars."
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
// Drives the REAL swarmforge/scripts/land_step_lib.bb (post-land-repoint!)
// against real git fixtures - never a JavaScript restatement of the guard.
//
// GENERATOR REACH (reached by construction, never by draw): every in_process
// shape the ticket's own scope names is exercised at least once - the empty
// mailbox and the landed ticket's lone parcel (both PROCEED), a different
// ticket's parcel, a note naming no ticket, an unreadable entry, TWO files
// beside each other (including two copies of the landed ticket's OWN
// parcel - the narrow-scope edge this invariant's wording covers explicitly:
// "a second file beside the landed one" still blocks even when that second
// file would, alone, also pass), the landed parcel's own claim-progress
// sidecar (PROCEEDS, the amendment's own reach requirement), and a
// claim-progress sidecar named for a DIFFERENT file (still blocks).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1773-property-';
const LANDED = 'BL-9773';
const OTHER = 'BL-9774';

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}

function gitOut(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
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

// A worktree ahead of origin/main by one local commit - .swarmforge/ is
// gitignored so the in_process files this test writes never register as a
// generic "uncommitted change" ahead of the in_process guard deciding
// (BL-1421's own ordering, mirrored here).
function initRepo(root) {
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');
  git(root, 'update-ref', 'refs/remotes/origin/main', gitOut(root, 'rev-parse', 'HEAD'));
  fs.writeFileSync(path.join(root, 'local.txt'), 'local\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', `${LANDED}: a local commit ahead of origin/main`);
}

function writeInProcessFile(root, name, kind) {
  const dir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  if (kind === 'unreadable') {
    // A directory where a handoff file would be: slurp throws, the guard's
    // own fail-closed path treats it as "cannot be read", never as the
    // landed ticket's own.
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    return;
  }
  if (kind === 'own-sidecar' || kind === 'other-sidecar') {
    // A handoff_lib-registered sidecar (handoffd's claim-progress shape) -
    // content is irrelevant to the guard, only the filename suffix and
    // which parcel's name it is appended to.
    fs.writeFileSync(path.join(dir, name), '{}\n');
    return;
  }
  const content =
    kind === 'landed'
      ? `type: git_handoff\ntask: ${LANDED}\n`
      : kind === 'other'
        ? `type: git_handoff\ntask: ${OTHER}\n`
        : 'type: note\nmessage: hello\n';
  fs.writeFileSync(path.join(dir, name), content);
}

// A sidecar's filename is the target parcel's own filename plus a
// handoff_lib-registered suffix (`.claim-progress.json`, one of several -
// the guard reuses the whole registry, but reaching one suffix reaches the
// shared code path). 'own-sidecar' names the LANDED file at index 0;
// 'other-sidecar' names a file that is never itself written to in_process -
// an orphan sidecar, the same shape as another parcel's leftover.
function fileNameFor(i, kind, priorNames) {
  if (kind === 'own-sidecar') return `${priorNames[0]}.claim-progress.json`;
  if (kind === 'other-sidecar') return 'zz_ghost.handoff.claim-progress.json';
  return `${String(i).padStart(2, '0')}_x.handoff`;
}

// Each entry: the in_process shape (a list of file kinds) and whether the
// invariant says the re-point should proceed. `expectRepoint: true` covers
// BOTH proceed cases the invariant text names - an empty mailbox (no
// pending file at all) and the landed ticket's own parcel plus only its own
// registered sidecars.
const SHAPES = [
  { name: 'empty', kinds: [], expectRepoint: true },
  { name: 'landed-alone', kinds: ['landed'], expectRepoint: true },
  { name: 'other-ticket-alone', kinds: ['other'], expectRepoint: false },
  { name: 'note-alone', kinds: ['note'], expectRepoint: false },
  { name: 'unreadable-alone', kinds: ['unreadable'], expectRepoint: false },
  { name: 'landed-duplicate', kinds: ['landed', 'landed'], expectRepoint: false },
  { name: 'landed-plus-note', kinds: ['landed', 'note'], expectRepoint: false },
  { name: 'landed-plus-other', kinds: ['landed', 'other'], expectRepoint: false },
  { name: 'landed-plus-own-sidecar', kinds: ['landed', 'own-sidecar'], expectRepoint: true },
  { name: 'landed-plus-other-sidecar', kinds: ['landed', 'other-sidecar'], expectRepoint: false },
];

// Per-shape fc.assert loops (bl1467's own invariant-2 pattern), not a single
// fc.constantFrom draw across every shape - a shared draw across 10 distinct
// shapes would need dozens of numRuns just to touch each one the reach
// floor's own minimum number of times; iterating the exact, small, fully
// enumerated shape list instead reaches every one BY CONSTRUCTION.
function runShapes(shapes, landedTaskTicketId, expectFor) {
  const RUNS = runsPerCell(3 * shapes.length, shapes.length);
  const reach = Object.fromEntries(shapes.map((s) => [s.name, 0]));

  for (const shape of shapes) {
    fc.assert(
      fc.property(fc.constant(shape), () => {
        reach[shape.name] += 1;
        const root = mkTmpDir(FIXTURE_PREFIX);
        initRepo(root);
        const names = [];
        shape.kinds.forEach((kind, i) => {
          const name = fileNameFor(i, kind, names);
          writeInProcessFile(root, name, kind);
          names.push(name);
        });
        try {
          const result = postLandRepoint(root, landedTaskTicketId);
          if (expectFor(shape)) {
            assert.equal(result.action, 'repointed', `shape ${shape.name}: expected :repointed, got: ${JSON.stringify(result)}`);
          } else {
            assert.equal(result.action, 'skipped', `shape ${shape.name}: expected :skipped, got: ${JSON.stringify(result)}`);
            assert.equal(result.reason, 'a parcel in its in_process', `shape ${shape.name}: expected the in_process reason, got: ${JSON.stringify(result)}`);
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: RUNS },
    );
  }

  assertReachFloor(reach, shapes.map((s) => s.name), RUNS, 'in_process shape');
}

test('BL-1773/BL-654: the re-point proceeds only when in_process is empty or holds the landed ticket\'s own parcel plus only its own registered sidecars', { timeout: 120000 }, () => {
  runShapes(SHAPES, LANDED, (shape) => shape.expectRepoint);
});

test('BL-1773/BL-654: with no landed ticket in view, every in_process shape that would otherwise proceed still blocks', { timeout: 60000 }, () => {
  runShapes(SHAPES.filter((s) => s.kinds.length > 0), null, () => false);
});
