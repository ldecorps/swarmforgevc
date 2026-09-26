'use strict';

// BL-1773: step handlers for "A land re-points the QA branch while QA holds
// the landed parcel". Drives the REAL land_step_cli.bb repoint verb (which
// calls the REAL land_step_lib.bb/post-land-repoint!) against a fixture
// repository with a bare origin under mkdtemp - never the live checkout,
// and never a reimplementation of the guard. Fixture shape follows
// bl1438PublishRepointsQaBranchSteps.js's own bare-origin-plus-worktree
// convention.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1773 A land re-points the QA branch while QA holds the landed parcel';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LANDED_TICKET = 'BL-9773';
const OTHER_TICKET = 'BL-9774';

const KNOWN_PARCELS = new Set([
  'a git_handoff whose task names a different ticket',
  'a note that names no ticket',
  "the landed ticket's git_handoff and a second parcel",
  "the landed ticket's git_handoff and a claim-progress sidecar named for a different parcel",
]);

// BL-1636: both roots below are created via fixtureReaper's own
// trackedTmpRoot (mkdtemp + onAbnormalExit reaping) rather than a bare
// fs.mkdtempSync - the standing step-handler-tmp-root guard
// (extension/test/stepHandlerTmpRootGuard.test.js) refuses a NEW handler
// that mkdtemps without registering for reaping. The bare-origin path
// derived FROM the tracked root (a sibling directory, not a second
// mkdtemp) is removed alongside it in the same exit hook.
const extraCleanupPaths = [];
process.on('exit', () => {
  for (const p of extraCleanupPaths) {
    fs.rmSync(p, { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

// A worktree whose HEAD sits behind origin/main - built by pushing an
// "advance" commit from a SEPARATE clone, then fetching it into the
// worktree without ever checking it out. The worktree's own tree stays
// clean (nothing to commit, nothing untracked) throughout.
function buildFixture(ctx) {
  const root = trackedTmpRoot('sfvc-bl1773-');
  const origin = `${root}-origin.git`;
  extraCleanupPaths.push(origin);

  execFileSync('git', ['init', '-q', '--bare', origin]);
  try {
    execFileSync('git', ['-C', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  } catch {
    // best-effort, matching the sibling fixture's own tolerance
  }

  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  for (const [k, v] of [
    ['user.email', 't@t'],
    ['user.name', 't'],
    ['commit.gpgsign', 'false'],
  ]) {
    git(root, 'config', k, v);
  }
  fs.symlinkSync(path.join(REPO_ROOT, 'swarmforge', 'scripts'), path.join(root, 'swarmforge', 'scripts'), 'dir');
  git(root, 'remote', 'add', 'origin', origin);
  // .swarmforge/ is gitignored in the real repo precisely so its own
  // land-repoint-log/in_process bookkeeping never registers as an
  // "uncommitted change" - without this the fixture's own in_process
  // mailbox writes below would falsely trip the dirty-tree guard before
  // the in_process guard this feature is about ever gets to decide.
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');
  git(root, 'push', '-q', '-u', 'origin', 'main');
  ctx.oldTip = git(root, 'rev-parse', 'HEAD');

  const advancer = trackedTmpRoot('sfvc-bl1773-adv-');
  execFileSync('git', ['clone', '-q', origin, advancer]);
  for (const [k, v] of [
    ['user.email', 't@t'],
    ['user.name', 't'],
    ['commit.gpgsign', 'false'],
  ]) {
    git(advancer, 'config', k, v);
  }
  fs.writeFileSync(path.join(advancer, 'advance.txt'), 'advance\n');
  git(advancer, 'add', '-A');
  git(advancer, 'commit', '-q', '-m', `${LANDED_TICKET}: the published land`);
  git(advancer, 'push', '-q', 'origin', 'main');

  // Updates the worktree's OWN origin/main ref without touching its HEAD
  // or its tree - exactly what post-land-repoint! reads to decide the
  // reset target.
  git(root, 'fetch', '-q', 'origin');

  ctx.root = root;
  ctx.origin = origin;
  ctx.landedTicket = LANDED_TICKET;
}

function writeInProcess(root, name, content) {
  const dir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

function runRepoint(ctx) {
  const out = execFileSync(
    'bb',
    [path.join(ctx.root, 'swarmforge', 'scripts', 'land_step_cli.bb'), 'repoint', ctx.root, ctx.landedTicket],
    { encoding: 'utf8' }
  );
  ctx.repointOut = out;
}

function indexOfLine(text, needlePrefix) {
  return text.split('\n').findIndex((line) => line.startsWith(needlePrefix));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a fixture repository with an origin whose main is ahead of a QA-shaped worktree branch$/, (ctx) => {
    buildFixture(ctx);
  });

  scoped(/^the QA-shaped worktree's tree is clean$/, (ctx) => {
    assert.equal(git(ctx.root, 'status', '--porcelain'), '', 'expected the freshly built fixture to be clean');
  });

  // ── Scenario 01 / 03 Given ───────────────────────────────────────────────
  scoped(/^the worktree's in_process holds a git_handoff whose task names the landed ticket$/, (ctx) => {
    writeInProcess(ctx.root, '00_landed.handoff', `type: git_handoff\ntask: ${ctx.landedTicket}\n`);
  });

  // ── Scenario 03 Given (amended 2026-09-26, QA spec gap 003254) ──────────
  scoped(/^the worktree's in_process holds that parcel's claim-progress sidecar$/, (ctx) => {
    writeInProcess(ctx.root, '00_landed.handoff.claim-progress.json', '{}\n');
  });

  // ── shared When ─────────────────────────────────────────────────────────
  scoped(/^the post-land re-point runs for the landed ticket$/, (ctx) => {
    runRepoint(ctx);
  });

  // ── Scenario 01 Then ────────────────────────────────────────────────────
  scoped(/^it prints LAND_REPOINTED and the branch tip equals origin\/main$/, (ctx) => {
    assert.match(ctx.repointOut, /^LAND_REPOINTED /m, `expected a LAND_REPOINTED line, got: ${ctx.repointOut}`);
    const head = git(ctx.root, 'rev-parse', 'HEAD');
    const originMain = git(ctx.origin, 'rev-parse', 'main');
    assert.equal(head, originMain, 'expected the worktree HEAD to equal origin/main after re-pointing');
  });

  // ── Scenario Outline 02 Given ───────────────────────────────────────────
  scoped(/^the worktree's in_process holds (.+)$/, (ctx, parcel) => {
    assert.ok(KNOWN_PARCELS.has(parcel), `unknown <parcel> example value: ${parcel}`);
    ctx.parcel = parcel;
    if (parcel === 'a git_handoff whose task names a different ticket') {
      writeInProcess(ctx.root, '00_other.handoff', `type: git_handoff\ntask: ${OTHER_TICKET}\n`);
    } else if (parcel === 'a note that names no ticket') {
      writeInProcess(ctx.root, '00_note.handoff', 'type: note\nmessage: hello\n');
    } else if (parcel === "the landed ticket's git_handoff and a claim-progress sidecar named for a different parcel") {
      writeInProcess(ctx.root, '00_landed.handoff', `type: git_handoff\ntask: ${ctx.landedTicket}\n`);
      writeInProcess(ctx.root, '01_second.handoff.claim-progress.json', '{}\n');
    } else {
      writeInProcess(ctx.root, '00_landed.handoff', `type: git_handoff\ntask: ${ctx.landedTicket}\n`);
      writeInProcess(ctx.root, '01_second.handoff', 'type: note\nmessage: hello\n');
    }
  });

  // ── Scenario Outline 02 Then ────────────────────────────────────────────
  scoped(/^it prints LAND_REPOINT_SKIPPED naming the in_process parcel$/, (ctx) => {
    const skippedIdx = indexOfLine(ctx.repointOut, 'LAND_REPOINT_SKIPPED ');
    assert.ok(skippedIdx !== -1, `expected a LAND_REPOINT_SKIPPED line, got: ${ctx.repointOut}`);
    const skippedLine = ctx.repointOut.split('\n')[skippedIdx];
    assert.ok(
      skippedLine.includes('a parcel in its in_process'),
      `expected the skip reason to name the in_process parcel, got: ${skippedLine}`
    );
  });

  scoped(/^the branch tip has not moved$/, (ctx) => {
    const head = git(ctx.root, 'rev-parse', 'HEAD');
    assert.equal(head, ctx.oldTip, 'expected HEAD to be unchanged since the re-point was skipped');
  });
}

module.exports = { registerSteps };
