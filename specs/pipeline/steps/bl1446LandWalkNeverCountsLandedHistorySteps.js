'use strict';

// BL-1446: step handlers for "The land walk never counts landed history,
// and a replay carries every hop's work". Drives the REAL
// land_step_lib.bb (land-plan, replay!) through a bb subprocess against a
// fixture git repository with its own origin, built fresh per scenario -
// never a reimplementation of the walk or the replay. Same style as the
// sibling ticket BL-1432's own handler (bl1432LandWalkRangesOverTheParcelSteps.js):
// land-plan is called directly via `bb -e`, not through land_step_cli.bb,
// so the "wide walk forced to origin/main" comparison needs no new CLI
// surface - it is just land-plan's own pre-existing :base override.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = "BL-1446 The land walk never counts landed history, and a replay carries every hop's work";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const STAGE_FILES = ['a', 'b', 'c', 'd', 'e'].map((c) => `backlog/active/BL-9001-${c}.yaml`);

const KNOWN_SYNCS = new Set([0, 1, 2]);

const FIXTURE_PREFIX = 'bl1446-fixture-';
const STALE_FIXTURE_AGE_MS = 60 * 60 * 1000;

// BL-971: a killed prior run traps nothing in its own exit handler - sweep
// stale roots by prefix BEFORE this run too, but only ones old enough that
// no concurrent run could still own them (never a blind prefix sweep,
// which is a concurrency bomb against a sibling run - BL-1385/BL-1390).
function sweepStaleFixtures() {
  const tmp = os.tmpdir();
  const now = Date.now();
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(tmp, name);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_FIXTURE_AGE_MS) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch {
      // Reaped by someone else between readdir and stat - fine.
    }
  }
}
sweepStaleFixtures();

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function initRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
}

function commit(root, relPath, content, message) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

function markOriginMainHere(root) {
  const sha = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', sha);
  return sha;
}

// BL-1446: `commit`'s own `git add -A` sweeps every untracked path in the
// WHOLE repo, not just the path it was asked to stage - including the
// handoff-archive fixture below, whenever HEAD happens to be on a
// different line (the sibling's) than the one the archive was written
// against. A checkout back to that other line then deletes the archive as
// a file tracked on the line just left and absent at the destination
// (proved live: swarmforge/scripts/test/land_step_lib_test_runner.bb's
// own BL-1446 fixture hit exactly this before excluding it here too).
// Excluded via .git/info/exclude - never gitignore'd content itself, never
// committed - so it can never be swept into an unrelated line's commit in
// the first place. Fixture-only concern: the real archive lives beside a
// real .gitignore.
function excludeHandoffArchive(root) {
  const excludeFile = path.join(root, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
  if (!existing.includes('.swarmforge/')) {
    fs.appendFileSync(excludeFile, '\n.swarmforge/\n');
  }
}

// The durable record land-plan's `parcel-own-base` reads back
// (salvage-lib/latest-item-handoffs): a completed git_handoff citing
// `commit` for `taskName`, in the shape bl1004ReworkClaimSteps.js's own
// seedPriorWork already uses.
function recordHandoff(root, taskName, commitSha) {
  excludeHandoffArchive(root);
  const rolesTsv = path.join(root, '.swarmforge', 'roles.tsv');
  if (!fs.existsSync(rolesTsv)) {
    fs.mkdirSync(path.dirname(rolesTsv), { recursive: true });
    fs.writeFileSync(rolesTsv, ['cleaner', 'cleaner', root, 'session', 'Cleaner', 'claude', 'task'].join('\t') + '\n');
  }
  const completedDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(completedDir, { recursive: true });
  fs.writeFileSync(
    path.join(completedDir, `00_${process.hrtime.bigint()}_from_documenter_to_qa_for_qa.handoff`),
    `task: ${taskName}\ncommit: ${commitSha}\nto: qa\nfrom: documenter\n`,
  );
}

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function libExpr(body) {
  return `(require '[cheshire.core :as json])\n(load-file "${LIB}")\n${body}`;
}

function landPlan(root, commitSha, taskTicketId, base) {
  // land-plan tells "no :base given" (fall back to parcel-own-base, the
  // real bounded-walk default every production caller gets) apart from
  // "force :base to this exact value" via `(contains? opts :base)` - a
  // literal `:base nil` in the map IS a present key (`contains?` does not
  // care what the value is), so the key must be OMITTED entirely to test
  // the real default, never included with a nil/falsy value.
  const opts = `:root "${root}" :commit "${commitSha}" :task-ticket-id "${taskTicketId}"${base ? ` :base "${base}"` : ''}`;
  const out = bb(libExpr(
    `(println (json/generate-string (land-step-lib/land-plan {${opts}})))`,
  ));
  return JSON.parse(out);
}

function replay(root, commitSha, taskTicketId, ownPaths) {
  const pathsForm = `[${ownPaths.map((p) => `"${p}"`).join(' ')}]`;
  const out = bb(libExpr(
    `(println (json/generate-string (land-step-lib/replay! {:root "${root}" :commit "${commitSha}" :task-ticket-id "${taskTicketId}" :own-paths ${pathsForm} :passengers #{}})))`,
  ));
  return JSON.parse(out);
}

function mkTmpDir(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fixtureRoots.push(root);
  return root;
}

// The five stage commits (coder, cleaner, architect, hardener, documenter)
// for BL-9001, with the last hop (documenter -> QA) recorded in the
// handoff archive - the Background every scenario shares. Returns the
// documenter tip (the QA-branch HEAD every scenario continues from) and
// the seed (the point origin/main was marked at, for building an
// independent sibling line off the same root).
function buildParcelBranch(ctx) {
  ctx.root = mkTmpDir(FIXTURE_PREFIX);
  initRepo(ctx.root);
  ctx.seed = markOriginMainHere(ctx.root);
  const roles = ['coder', 'cleaner', 'architect', 'hardener', 'documenter'];
  let tip;
  STAGE_FILES.forEach((file, i) => {
    tip = commit(ctx.root, file, 'id: BL-9001\n', `BL-9001: ${roles[i]}`);
  });
  ctx.documenterTip = tip;
  recordHandoff(ctx.root, 'BL-9001-fixture', ctx.documenterTip);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with an origin, a main branch, and a parcel branch carrying five stage commits for one ticket whose last hop is recorded in the handoff archive$/, (ctx) => {
    buildParcelBranch(ctx);
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^a sibling ticket's commit lands on origin\/main after the parcel's last hop$/, (ctx) => {
    // An independent line off the ORIGINAL seed (never an ancestor of the
    // parcel's own five stage commits), then origin/main itself advances
    // to it - a real land, not merely a commit sitting somewhere.
    git(ctx.root, 'checkout', '-q', ctx.seed);
    const siblingCommit = commit(ctx.root, 'backlog/active/BL-9002-x.yaml', 'id: BL-9002\n',
      'BL-9002: sibling, will land on origin/main after the hop');
    git(ctx.root, 'update-ref', 'refs/remotes/origin/main', siblingCommit);
    ctx.originMainForced = siblingCommit;
    git(ctx.root, 'checkout', '-q', ctx.documenterTip);
  });

  scoped(/^the parcel branch merges origin\/main$/, (ctx) => {
    git(ctx.root, 'merge', '-q', '--no-ff', '-m', 'Merge origin/main into QA.', 'origin/main');
    ctx.tip = git(ctx.root, 'rev-parse', 'HEAD');
  });

  scoped(/^the land step plans the parcel's tip$/, (ctx) => {
    ctx.plan = landPlan(ctx.root, ctx.tip, 'BL-9001');
  });

  scoped(/^the verdict is LAND_CLEAN$/, (ctx) => {
    assert.equal(ctx.plan.action, 'land', `expected :land (LAND_CLEAN), got: ${JSON.stringify(ctx.plan)}`);
  });

  scoped(/^the wide walk forced to origin\/main gives the same verdict$/, (ctx) => {
    const originMain = git(ctx.root, 'rev-parse', 'refs/remotes/origin/main');
    const wide = landPlan(ctx.root, ctx.tip, 'BL-9001', originMain);
    assert.equal(wide.action, ctx.plan.action,
      `expected the wide walk to agree (${ctx.plan.action}), got: ${JSON.stringify(wide)}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^an unlanded sibling commit sits inside the parcel's own range$/, (ctx) => {
    // Off the SAME seed, but merged DIRECTLY into the parcel branch -
    // never landed on origin/main, which stays at its original position.
    git(ctx.root, 'checkout', '-q', ctx.seed);
    ctx.siblingCommit = commit(ctx.root, 'backlog/active/BL-9002-x.yaml', 'id: BL-9002\n',
      'BL-9002: unlanded sibling inside the parcel\'s own range');
    git(ctx.root, 'checkout', '-q', ctx.documenterTip);
    git(ctx.root, 'merge', '-q', '--no-ff', '-m', 'Merge sibling into QA.', ctx.siblingCommit);
    ctx.documenterTip = git(ctx.root, 'rev-parse', 'HEAD');
  });

  scoped(/^the verdict is LAND_REPLAY$/, (ctx) => {
    assert.equal(ctx.plan.action, 'replay', `expected :replay (LAND_REPLAY), got: ${JSON.stringify(ctx.plan)}`);
    assert.ok(ctx.plan.entangled && ctx.plan.entangled.includes('BL-9002'),
      `expected BL-9002 named as entangled, got: ${JSON.stringify(ctx.plan)}`);
  });

  scoped(/^the replay tip carries every path the five stage commits changed, byte-identical to the cited tip$/, (ctx) => {
    const ownPaths = ctx.plan['own-paths'] || [];
    assert.deepEqual([...ownPaths].sort(), [...STAGE_FILES].sort(),
      `expected own-paths to be exactly the five stage files, got: ${JSON.stringify(ownPaths)}`);
    const result = replay(ctx.root, ctx.tip, 'BL-9001', ownPaths);
    assert.ok(result.success, `expected replay! to succeed, got: ${JSON.stringify(result)}`);
    for (const p of STAGE_FILES) {
      const citedBlob = git(ctx.root, 'rev-parse', `${ctx.tip}:${p}`);
      const replayedBlob = git(ctx.root, 'rev-parse', `${result.commit}:${p}`);
      assert.equal(replayedBlob, citedBlob,
        `expected ${p} to be byte-identical (same blob) between the replay and the cited tip`);
    }
  });

  // ── Scenario 03 (Outline) ────────────────────────────────────────────
  scoped(/^the parcel branch merges origin\/main (\d+) times after its last hop$/, (ctx, syncsStr) => {
    const syncs = Number(syncsStr);
    if (!KNOWN_SYNCS.has(syncs)) {
      throw new Error(`bl1446: unrecognized <syncs> example value "${syncsStr}"`);
    }
    let tip = ctx.documenterTip;
    for (let n = 0; n < syncs; n += 1) {
      git(ctx.root, 'checkout', '-q', 'origin/main');
      const siblingCommit = commit(ctx.root, `backlog/active/BL-910${n}-x.yaml`, `id: BL-910${n}\n`,
        `BL-910${n}: another sibling landing on origin/main, sync ${n}`);
      git(ctx.root, 'update-ref', 'refs/remotes/origin/main', siblingCommit);
      git(ctx.root, 'checkout', '-q', tip);
      git(ctx.root, 'merge', '-q', '--no-ff', '-m', `Merge origin/main into QA, sync ${n}.`, 'origin/main');
      tip = git(ctx.root, 'rev-parse', 'HEAD');
    }
    ctx.tip = tip;
  });

  scoped(/^the land step plans the parcel's tip with the bounded walk and again with the walk forced to origin\/main$/, (ctx) => {
    const originMain = git(ctx.root, 'rev-parse', 'refs/remotes/origin/main');
    ctx.bounded = landPlan(ctx.root, ctx.tip, 'BL-9001');
    ctx.wide = landPlan(ctx.root, ctx.tip, 'BL-9001', originMain);
  });

  scoped(/^both verdicts are identical$/, (ctx) => {
    assert.equal(ctx.bounded.action, ctx.wide.action,
      `expected the bounded and wide verdicts to agree, got bounded=${JSON.stringify(ctx.bounded)} wide=${JSON.stringify(ctx.wide)}`);
  });

  scoped(/^both own-path sets are identical$/, (ctx) => {
    const boundedPaths = [...(ctx.bounded['own-paths'] || [])].sort();
    const widePaths = [...(ctx.wide['own-paths'] || [])].sort();
    assert.deepEqual(boundedPaths, widePaths,
      `expected the bounded and wide own-path sets to agree, got bounded=${JSON.stringify(boundedPaths)} wide=${JSON.stringify(widePaths)}`);
  });
}

module.exports = { registerSteps };
