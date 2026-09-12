'use strict';

// BL-1546: step handlers for "a path owned only by a closed ticket is
// never silently excluded". Drives the REAL swarmforge/scripts/land_step_lib.bb
// (own-paths, direct) and swarmforge/scripts/land_step_cli.bb (the full
// land-plan/CLI, for the scenarios whose Then asserts an actual CLI exit
// and reason line) - never a reimplementation of the decision, the same
// split bl1544AmbiguousSubjectNeverSilentlyExcludesSteps.js already uses
// for the git-fixture-constructible vs. CLI-observable halves of one
// ticket's scenarios.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1546 A path owned only by a closed ticket is never silently excluded';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const LANDING = 'BL-9646';
const SIBLING = 'BL-9647';
const SHARED_PATH = 'docs/shared.md';

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

function markOriginMain(root) {
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
}

// A sibling ticket filed under backlog/done/ on origin/main, nested by
// milestone the way the live repo actually files a done ticket
// (backlog/done/M8/...) - main-ticket-sources walks that layout
// recursively, so a flat backlog/done/<id>.yaml would exercise a shape the
// live jam never hits.
function writeDoneTicket(root, id) {
  commitFile(root, `backlog/done/M8/${id}-fixture.yaml`, `id: ${id}\nstatus: done\nhuman_approval: approved\n`, `${id}: done ticket fixture file`);
}

function writeActiveTicket(root, id) {
  commitFile(root, `backlog/active/${id}-fixture.yaml`, `id: ${id}\nhuman_approval: approved\n`, `${id}: active ticket fixture file`);
}

function ownPaths(root, commit, siblings) {
  const set = siblings.map((s) => `"${s}"`).join(' ');
  const expr = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string (land-step-lib/own-paths "${root}" "${commit}" "${LANDING}" #{${set}})))`;
  const r = spawnSync('bb', ['-e', expr], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function runCli(root, commit) {
  const r = spawnSync('bb', [CLI, `${LANDING}-fixture`, commit], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository with an origin, a main branch, a reviewing branch, a landing ticket, and a sibling ticket whose YAML is filed under backlog\/done\/ on origin\/main$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1546-fixture-');
      git(root, 'init', '-q', '-b', 'main', '.');
      git(root, 'config', 'user.email', 't@t');
      git(root, 'config', 'user.name', 't');
      git(root, 'config', 'commit.gpgsign', 'false');
      commitFile(root, 'seed.txt', 'seed\n', 'seed before origin/main');
      writeDoneTicket(root, SIBLING);
      markOriginMain(root);
      git(root, 'checkout', '-q', '-b', 'reviewing');
      ctx.root = root;
      ctx.siblingClosed = true;
    },
  );

  scoped(
    /^the sibling ticket's YAML is filed under backlog\/active\/ on origin\/main instead of backlog\/done\/$/,
    (ctx) => {
      // Re-file the fixture: drop the done copy and re-mark origin/main with
      // an active one instead, so this scenario's origin/main carries the
      // sibling under exactly one folder - active, not done.
      git(ctx.root, 'checkout', '-q', 'main');
      git(ctx.root, 'rm', '-rq', 'backlog/done');
      git(ctx.root, 'commit', '-q', '-m', 'remove the done sibling fixture for this scenario');
      writeActiveTicket(ctx.root, SIBLING);
      markOriginMain(ctx.root);
      git(ctx.root, 'checkout', '-q', 'reviewing');
      ctx.siblingClosed = false;
    },
  );

  scoped(
    /^a commit on the reviewing branch touching a path whose subject names only the closed sibling's id and leads with none$/,
    (ctx) => {
      commitFile(ctx.root, SHARED_PATH, 'v1\n', `Update the shared doc for ${SIBLING}'s chokepoint fold`);
    },
  );

  scoped(
    /^a commit on the reviewing branch touching a path whose subject names only the sibling's id and leads with none$/,
    (ctx) => {
      commitFile(ctx.root, SHARED_PATH, 'v1\n', `Update the shared doc for ${SIBLING}'s chokepoint fold`);
    },
  );

  scoped(/^a commit whose subject leads with the landing ticket's id also touches that path$/, (ctx) => {
    commitFile(ctx.root, SHARED_PATH, 'v2\n', `${LANDING}: own touch on the shared doc`);
  });

  scoped(/^that path's content at the tip differs from origin\/main$/, (ctx) => {
    ctx.tipDiffers = true;
  });

  scoped(/^that path's content at the tip is identical to origin\/main$/, (ctx) => {
    // origin/main never had this path (marked before the reviewing branch's
    // commit creates the file), so "identical" means absent on both sides -
    // deleting it again nets the two-tree diff to nothing for this path.
    git(ctx.root, 'rm', '-q', SHARED_PATH);
    git(ctx.root, 'commit', '-q', '-m', 'the shared doc is removed again, back to origin/main\'s state');
  });

  scoped(/^no commit naming the landing ticket touches that path$/, () => {
    // No-op: no prior step gave the landing ticket its own commit on the
    // shared path in this scenario - asserted implicitly by the Then step
    // reading a real refusal/exclusion rather than a kept path.
  });

  scoped(/^the land step computes the landing ticket's own paths$/, (ctx) => {
    commitFile(ctx.root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\n`, `${LANDING}: own bookkeeping`);
    ctx.tip = head(ctx.root);
    ctx.ownPaths = ownPaths(ctx.root, ctx.tip, [SIBLING]);
  });

  scoped(/^the land step runs for the landing ticket at the tip$/, (ctx) => {
    commitFile(ctx.root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\n`, `${LANDING}: own bookkeeping`);
    ctx.tip = head(ctx.root);
    ctx.cli = runCli(ctx.root, ctx.tip);
  });

  scoped(
    /^that path is kept for the landing ticket with the closed sibling reported as a passenger, neither excluded nor refused$/,
    (ctx) => {
      assert.equal(ctx.ownPaths.warning, null, `expected no refusal, got: ${JSON.stringify(ctx.ownPaths)}`);
      assert.ok(
        (ctx.ownPaths.paths || []).includes(SHARED_PATH),
        `expected the shared path kept, got: ${JSON.stringify(ctx.ownPaths)}`,
      );
      assert.ok(
        (ctx.ownPaths.passengers || []).includes(SIBLING),
        `expected the closed sibling as a passenger, got: ${JSON.stringify(ctx.ownPaths)}`,
      );
      assert.ok(
        !(ctx.ownPaths.excluded || []).some((e) => e.path === SHARED_PATH),
        `the shared path must never be excluded, got: ${JSON.stringify(ctx.ownPaths)}`,
      );
    },
  );

  scoped(
    /^it exits LAND_ESCALATE and the reason names that commit, the closed sibling's id, and the path$/,
    (ctx) => {
      assert.equal(ctx.cli.status, 1, `expected LAND_ESCALATE (exit 1), got: ${JSON.stringify(ctx.cli)}`);
      assert.ok(ctx.cli.stdout.includes('LAND_ESCALATE'), `expected LAND_ESCALATE, got: ${ctx.cli.stdout}`);
      assert.ok(ctx.cli.stdout.includes(SHARED_PATH), `reason does not name the path: ${ctx.cli.stdout}`);
      assert.ok(ctx.cli.stdout.includes(SIBLING), `reason does not name the closed sibling: ${ctx.cli.stdout}`);
    },
  );

  scoped(/^the path is never printed as an EXCLUDED_SIBLING_PATH$/, (ctx) => {
    assert.ok(
      !ctx.cli.stdout.includes(`EXCLUDED_SIBLING_PATH ${SHARED_PATH}`),
      `the path must never be printed as EXCLUDED_SIBLING_PATH, got: ${ctx.cli.stdout}`,
    );
  });

  scoped(/^the land proceeds with no refusal and no exclusion for that path$/, (ctx) => {
    assert.equal(ctx.cli.status, 0, `expected a clean/replay outcome, got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(!ctx.cli.stdout.includes('LAND_ESCALATE'), `expected no escalation, got: ${ctx.cli.stdout}`);
    assert.ok(
      !ctx.cli.stdout.includes(`EXCLUDED_SIBLING_PATH ${SHARED_PATH}`),
      `expected no exclusion of the path, got: ${ctx.cli.stdout}`,
    );
  });

  scoped(
    /^it exits LAND_REPLAY and prints that path as an EXCLUDED_SIBLING_PATH owned by the sibling$/,
    (ctx) => {
      assert.equal(ctx.cli.status, 0, `expected LAND_REPLAY (exit 0), got: ${JSON.stringify(ctx.cli)}`);
      assert.ok(ctx.cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.cli.stdout}`);
      assert.ok(
        ctx.cli.stdout.includes(`EXCLUDED_SIBLING_PATH ${SHARED_PATH} ${SIBLING}`),
        `expected the path excluded and owned by the sibling, got: ${ctx.cli.stdout}`,
      );
    },
  );
}

module.exports = { registerSteps };
