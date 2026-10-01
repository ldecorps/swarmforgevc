'use strict';

// BL-1853's two declared invariants (property authorship rests with the
// coder, first pass - BL-654):
//
//   1. "A cached diff is used only for the exact commit it was read from;
//      a missing, unreadable or mismatched entry is read again from git,
//      never taken as an empty diff."
//   2. "A land plan's verdict with the cache equals its verdict without
//      it."
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb (land-plan) against
// real git fixtures - never a JavaScript restatement of the cache or the
// entanglement/attribution walk.
//
// GENERATOR REACH (by CONSTRUCTION, never by draw). One cell per corruption
// outcome ('some-corrupted', 'none-corrupted'): corruptCount is drawn
// 0-4 and clamped to the sibling commit count, so both "nothing to
// corrupt" and "at least one real corruption" occur by construction, not
// by hoping a uniform draw lands on each. Each corrupted entry's state
// (missing/corrupt/mismatched) cycles deterministically through all three
// BL-1853 scenario-02 shapes across the corrupted indices, so a fix that
// only happens to handle one shape cannot hide behind a generator that
// never produces the other two. Own/sibling commit counts each vary 1-4
// so a fix that only happens to work for a single fixed shape cannot hide
// either.
//
// THE INVARIANT ITSELF, proven across three cache states on the SAME
// fixture and SAME cited tip (never comparing two different repositories'
// verdicts against each other): disabled (never touches the cache files),
// warm (every sibling commit's diff freshly cached), and partly-corrupted
// (warm, then some entries corrupted) all produce the SAME verdict - the
// ticket's own "How": "plan with the cache warm, cold and partly
// corrupted, same verdict." :commit/:branch are excluded from the
// comparison: each land-plan call builds its own fresh replay commit (a
// real git object with its own timestamp), so those two fields legitimately
// differ between independent calls even with no bug - the invariant is
// about the verdict's own content.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1853-property-';
const LANDING_TICKET = 'BL-9801';
const SIBLING_TICKET = 'BL-9802';

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

function gitCommonDir(root) {
  return path.resolve(root, gitOut(root, 'rev-parse', '--git-common-dir'));
}

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' });
}

function resetScratch(root, commit) {
  const id = `${LANDING_TICKET}-${commit.slice(0, 10)}`;
  try {
    git(root, 'branch', '-D', `land-replay/${id}`);
  } catch {
    // no such branch yet - fine
  }
  fs.rmSync(path.join(gitCommonDir(root), 'land-replay-worktrees'), { recursive: true, force: true });
}

function landPlan(root, commit, { disableCache } = {}) {
  resetScratch(root, commit);
  const binding = disableCache ? '[land-step-lib/*diff-cache-disabled* true]' : '[]';
  const call = `(land-step-lib/land-plan {:root ${JSON.stringify(root)} :commit ${JSON.stringify(commit)} :task-ticket-id ${JSON.stringify(LANDING_TICKET)}})`;
  const expr = `(require '[cheshire.core :as json])\n(load-file ${JSON.stringify(LIB)})\n(binding ${binding} (println (json/generate-string ${call})))`;
  const out = bb(expr);
  const jsonLine = out
    .trim()
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .pop();
  return JSON.parse(jsonLine);
}

function verdictForComparison(plan) {
  const copy = { ...plan };
  delete copy.commit;
  delete copy.branch;
  return copy;
}

function siblingCommits(root, count) {
  const shas = [];
  for (let i = 0; i < count; i += 1) {
    shas.push(commitFile(root, `sibling-${i}.txt`, `sibling ${i}\n`, `${SIBLING_TICKET}: sibling ${i}`));
  }
  return shas;
}

const CORRUPTION_KINDS = ['missing', 'corrupt', 'mismatched'];

function corruptEntry(root, commit, kind) {
  const p = path.join(gitCommonDir(root), 'land-diff-cache', commit);
  if (kind === 'missing') {
    fs.rmSync(p, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (kind === 'corrupt') {
    fs.writeFileSync(p, 'not edn {{{');
  } else {
    fs.writeFileSync(p, '{:commit "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" :diff {"bogus.txt" {:added #{"x"}}}}');
  }
}

const CELLS = ['some-corrupted', 'none-corrupted'];
const RUNS_PER_CELL = runsPerCell(8 * CELLS.length, CELLS.length);

// One fixture: `siblingCount` sibling (entangled) commits, `ownCount`
// landing-ticket commits on top, then the cache compared disabled vs warm
// vs (when corruptCount > 0) partly-corrupted - all against the SAME tip.
function runCell(reach, cell, ownCount, siblingCount, corruptCount) {
  reach[cell] += 1;
  const root = mkTmpDir(FIXTURE_PREFIX);
  try {
    initRepo(root);
    commitFile(root, 'seed.txt', 'seed\n', 'seed');
    git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

    const siblingShas = siblingCommits(root, siblingCount);
    for (let i = 0; i < ownCount; i += 1) {
      commitFile(root, `own-${i}.txt`, `own ${i}\n`, `${LANDING_TICKET}: own ${i}`);
    }
    const tip = head(root);

    const coldPlan = landPlan(root, tip, { disableCache: true });
    const warmPlan = landPlan(root, tip);
    assert.deepEqual(
      verdictForComparison(warmPlan),
      verdictForComparison(coldPlan),
      `warm vs cold verdict differs: ${JSON.stringify({ warmPlan, coldPlan })}`
    );

    if (corruptCount > 0) {
      for (let i = 0; i < corruptCount; i += 1) {
        corruptEntry(root, siblingShas[i], CORRUPTION_KINDS[i % CORRUPTION_KINDS.length]);
      }
      const partlyCorruptedPlan = landPlan(root, tip);
      assert.deepEqual(
        verdictForComparison(partlyCorruptedPlan),
        verdictForComparison(coldPlan),
        `partly-corrupted vs cold verdict differs: ${JSON.stringify({ partlyCorruptedPlan, coldPlan })}`
      );
    }

    return true;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('BL-1853/BL-654 invariants: a cached diff is used only for its exact commit, and a land plan\'s verdict is the same cold, warm, or partly corrupted', () => {
  const reach = { 'some-corrupted': 0, 'none-corrupted': 0 };

  // Each cell is its OWN fc.assert, never a shared draw whose extremes
  // might not land within budget (BL-654's "asserted reachability floor,
  // never a hoped-for one") - 'none-corrupted' is reached by every run of
  // the first property, 'some-corrupted' by every run of the second,
  // regardless of what fast-check happens to sample.
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }), (ownCount, siblingCount) =>
      runCell(reach, 'none-corrupted', ownCount, siblingCount, 0)
    ),
    { numRuns: RUNS_PER_CELL }
  );

  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 4 }),
      (ownCount, siblingCount, corruptDraw) =>
        runCell(reach, 'some-corrupted', ownCount, siblingCount, Math.min(corruptDraw, siblingCount))
    ),
    { numRuns: RUNS_PER_CELL }
  );

  assertReachFloor(reach, CELLS, RUNS_PER_CELL, 'BL-1853 land-diff-cache cell');
}, propertyLaneTimeoutMs(90000));
