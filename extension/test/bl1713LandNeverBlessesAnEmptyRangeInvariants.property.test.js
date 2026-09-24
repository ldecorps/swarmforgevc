'use strict';

// BL-1713's two declared invariants (coder first authorship - BL-654):
//
// 1. "The land step prints LAND_CLEAN or LAND_REPLAY only for a range
//    origin/main..<commit> holding at least one commit credited to the
//    landing ticket; any other range is LAND_ESCALATE with no commit
//    built, no branch created and no register row retired."
// 2. "The commit a land plans is the one the caller named: a citation
//    that resolves to different commits in the caller's checkout and in
//    the repo root's checkout is refused, never resolved silently in
//    either."
//
// Both are properties of swarmforge/scripts/land_step_cli.bb /
// land_step_lib.bb's own land-plan - a real Babashka CLI over real git
// fixtures, driven the same way bl1687's own loader-probe properties drive
// real subprocesses (SUBPROCESS_HEAVY_TIMEOUT_MS), never a
// reimplementation of the citation or range checks under test.
//
// Generator reach: invariant 1's population is the FIVE range shapes that
// decide whether a range credits the landing ticket (a commit tagged for
// it alone, tagged for it plus an untagged noise commit, an untagged
// commit alone, an empty range, and a commit tagged for a DIFFERENT
// ticket alone). Invariant 2's population is the THREE checkout/citation
// shapes (matching checkouts citing HEAD, mismatched checkouts citing
// HEAD, mismatched checkouts citing a full sha - FIRM, unaffected). Both
// draw a shuffled full permutation of their own population per run, so
// every shape is touched by construction (BL-1062), never a coin flip.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_STEP_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const A_ID = 'BL-9711';
const OTHER_ID = 'BL-9712';
const TASK = 'BL-9711-fixture';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function head(root) {
  return git(root, 'rev-parse', 'HEAD');
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

function initRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
}

function markOriginMain(root) {
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
}

function runCli(cwd, commit, repoRoot) {
  const r = spawnSync('bb', [LAND_STEP_CLI, TASK, commit, repoRoot], { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ── Invariant 1: a range check ──────────────────────────────────────────

const RANGE_SHAPES = [
  { label: 'ticket-commit-only', commitTags: [A_ID], credits: true },
  { label: 'ticket-plus-noise', commitTags: [A_ID, null], credits: true },
  { label: 'noise-only', commitTags: [null], credits: false },
  { label: 'empty-range', commitTags: [], credits: false },
  { label: 'other-ticket-only', commitTags: [OTHER_ID], credits: false },
];

function buildRangeFixture(root, shape) {
  initRepo(root);
  commitFile(root, 'seed.txt', 'seed\n', 'seed');
  markOriginMain(root);
  shape.commitTags.forEach((tag, i) => {
    const subject = tag ? `${tag}: commit ${i}` : `an untagged bystander commit ${i}`;
    commitFile(root, `f${i}.txt`, `${i}\n`, subject);
  });
  return head(root);
}

test(
  'property (BL-1713 invariant 1): a range is LAND_CLEAN/LAND_REPLAY only when it holds a commit credited to the landing ticket',
  () => {
    const RUNS = runsPerCell(3 * RANGE_SHAPES.length, RANGE_SHAPES.length);
    const reach = Object.fromEntries(RANGE_SHAPES.map((s) => [s.label, 0]));
    fc.assert(
      fc.property(
        fc.shuffledSubarray(RANGE_SHAPES, { minLength: RANGE_SHAPES.length, maxLength: RANGE_SHAPES.length }),
        (order) => {
          for (const shape of order) {
            reach[shape.label] += 1;
            const root = mkTmpDir('bl1713-prop1-');
            const tip = buildRangeFixture(root, shape);
            const branchesBefore = git(root, 'branch', '--list', 'land-replay*');
            const result = runCli(root, tip, root);
            const firstLine = result.stdout.split('\n')[0] || '';
            if (shape.credits) {
              assert.notEqual(
                firstLine,
                'LAND_ESCALATE',
                `${shape.label}: expected a credited range to build (LAND_CLEAN/LAND_REPLAY), got:\n${result.stdout}${result.stderr}`
              );
            } else {
              assert.equal(result.status, 1, `${shape.label}: expected exit 1, got ${result.status}: ${result.stdout}${result.stderr}`);
              assert.equal(firstLine, 'LAND_ESCALATE', `${shape.label}: expected LAND_ESCALATE, got:\n${result.stdout}`);
              const reasonLine = result.stdout.split('\n')[1] || '';
              assert.ok(
                reasonLine.includes(A_ID),
                `${shape.label}: expected the reason to name ${A_ID}, got: ${reasonLine}`
              );
              const branchesAfter = git(root, 'branch', '--list', 'land-replay*');
              assert.equal(
                branchesAfter,
                branchesBefore,
                `${shape.label}: expected no land-replay branch built for an unblessed range`
              );
            }
          }
        }
      ),
      { numRuns: RUNS }
    );
    assertReachFloor(reach, RANGE_SHAPES.map((s) => s.label), RUNS, 'BL-1713 range shape');
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

// ── Invariant 2: a citation-checkout check ──────────────────────────────

const CITATION_SHAPES = [
  { label: 'matching-checkouts-cite-head', mismatch: false, citeFullSha: false },
  { label: 'mismatched-checkouts-cite-head', mismatch: true, citeFullSha: false },
  { label: 'mismatched-checkouts-cite-full-sha', mismatch: true, citeFullSha: true },
  // BL-1713's own "How" direction: "A cwd outside any checkout (a scratch
  // copy of the tool, QA.prompt's landed-tool bullet) keeps today's
  // repo-root resolution" - the nil branch of caller-cwd-commit. Neither
  // the acceptance feature nor this property originally exercised it:
  // hand-mutating `(and cwd-sha (not= cwd-sha canonical))` to drop the
  // `cwd-sha` nil-guard survived completely undetected and made EVERY
  // land run from a non-checkout cwd wrongly LAND_ESCALATE, confirmed by
  // running the mutant against a real fixture before this cell existed.
  { label: 'cwd-outside-any-checkout', mismatch: false, citeFullSha: true, cwdOutsideCheckout: true },
];

function buildCitationFixture(work, shape) {
  const mainCheckout = path.join(work, 'main');
  initRepo(mainCheckout);
  commitFile(mainCheckout, 'seed.txt', 'seed\n', 'seed');
  const seedSha = head(mainCheckout);
  markOriginMain(mainCheckout);
  commitFile(mainCheckout, 'a.txt', 'a\n', `${A_ID}: A's own commit`);
  const landingSha = head(mainCheckout);

  let cwdDir = mainCheckout;
  if (shape.mismatch) {
    cwdDir = path.join(work, 'cwd');
    git(mainCheckout, 'worktree', 'add', '-q', '--detach', cwdDir, seedSha);
  } else if (shape.cwdOutsideCheckout) {
    cwdDir = path.join(work, 'not-a-checkout');
    fs.mkdirSync(cwdDir, { recursive: true });
  }
  return { mainCheckout, cwdDir, seedSha, landingSha };
}

function namesCheckoutMismatch(reasonLine) {
  return reasonLine.includes('resolves to') && reasonLine.includes("in the caller's own checkout");
}

test(
  'property (BL-1713 invariant 2): a citation is refused for checkout disagreement only when the caller checkout and the repo root actually resolve it differently',
  () => {
    const RUNS = runsPerCell(3 * CITATION_SHAPES.length, CITATION_SHAPES.length);
    const reach = Object.fromEntries(CITATION_SHAPES.map((s) => [s.label, 0]));
    fc.assert(
      fc.property(
        fc.shuffledSubarray(CITATION_SHAPES, { minLength: CITATION_SHAPES.length, maxLength: CITATION_SHAPES.length }),
        (order) => {
          for (const shape of order) {
            reach[shape.label] += 1;
            const work = mkTmpDir('bl1713-prop2-');
            const { mainCheckout, cwdDir, seedSha, landingSha } = buildCitationFixture(work, shape);
            const citation = shape.citeFullSha ? landingSha : 'HEAD';
            const result = runCli(cwdDir, citation, mainCheckout);
            const firstLine = result.stdout.split('\n')[0] || '';
            const reasonLine = result.stdout.split('\n')[1] || '';

            if (shape.mismatch && !shape.citeFullSha) {
              assert.equal(result.status, 1, `${shape.label}: expected exit 1, got ${result.status}: ${result.stdout}${result.stderr}`);
              assert.equal(firstLine, 'LAND_ESCALATE', `${shape.label}: expected LAND_ESCALATE, got:\n${result.stdout}`);
              assert.ok(
                namesCheckoutMismatch(reasonLine) && reasonLine.includes(seedSha) && reasonLine.includes(landingSha),
                `${shape.label}: expected the reason to name both ${seedSha} and ${landingSha}, got: ${reasonLine}`
              );
            } else {
              // Matching checkouts, a mismatched checkout citing a full sha
              // (FIRM, approval_context: unaffected), or a cwd outside any
              // checkout at all (the nil branch of caller-cwd-commit, the
              // ticket's own documented "scratch copy of the tool" case) -
              // never refused for the checkout-disagreement reason
              // specifically, whatever else the range check separately
              // decides.
              assert.ok(
                !(firstLine === 'LAND_ESCALATE' && namesCheckoutMismatch(reasonLine)),
                `${shape.label}: expected no checkout-mismatch refusal, got:\n${result.stdout}`
              );
            }
          }
        }
      ),
      { numRuns: RUNS }
    );
    assertReachFloor(reach, CITATION_SHAPES.map((s) => s.label), RUNS, 'BL-1713 citation shape');
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
