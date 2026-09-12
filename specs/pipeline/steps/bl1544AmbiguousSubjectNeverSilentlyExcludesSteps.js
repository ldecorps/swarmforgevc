'use strict';

// BL-1544: step handlers for "an ambiguous commit subject never silently
// excludes a path". Drives the REAL swarmforge/scripts/land_step_lib.bb
// (own-paths, direct) and swarmforge/scripts/land_step_cli.bb (the full
// land-plan/CLI, for the scenario whose Then asserts an actual
// LAND_ESCALATE exit and reason line) - never a reimplementation of the
// decision, the same split bl1481SharedPathContentCheckSteps.js already
// uses for the git-fixture-constructible vs. CLI-observable halves of one
// ticket's scenarios.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1544 An ambiguous commit subject never silently excludes a path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const LANDING = 'BL-9544';
const SIBLING = 'BL-9545';
const THIRD = 'BL-9546';
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

// "a done sibling ticket whose lineage never reads landed": filed done,
// approved (so it never BLOCKS a shared path either - the scenarios here
// are about attribution, not about BL-1332/BL-1481's separate approval
// question), with no line of its own actually reflected on origin/main.
// Committed on its OWN, under a bare, unambiguous subject - never folded
// into a later `git add -A` commit, which would attribute the ticket
// file's own path to whatever ambiguous subject happened to run next.
function writeDoneTicket(root, id) {
  commitFile(root, `backlog/done/${id}-fixture.yaml`, `id: ${id}\nstatus: done\nhuman_approval: approved\n`, `${id}: done ticket fixture file`);
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
    /^a fixture repository with an origin, a main branch, a reviewing branch, a landing ticket, and a done sibling ticket whose lineage never reads landed$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1544-fixture-');
      git(root, 'init', '-q', '-b', 'main', '.');
      git(root, 'config', 'user.email', 't@t');
      git(root, 'config', 'user.name', 't');
      git(root, 'config', 'commit.gpgsign', 'false');
      commitFile(root, 'seed.txt', 'seed\n', 'seed before origin/main');
      markOriginMain(root);
      writeDoneTicket(root, SIBLING);
      git(root, 'checkout', '-q', '-b', 'reviewing');
      ctx.root = root;
    },
  );

  scoped(
    /^a commit on the reviewing branch touching a path whose subject leads with the sibling's id and mentions the landing ticket's id later in the same line$/,
    (ctx) => {
      commitFile(
        ctx.root,
        SHARED_PATH,
        'v1\n',
        `${SIBLING}: fix the doc, related to ${LANDING}'s own chokepoint fold`,
      );
    },
  );

  scoped(/^the land step computes the landing ticket's own paths$/, (ctx) => {
    commitFile(ctx.root, 'backlog/active/BL-9544-fixture.yaml', `id: ${LANDING}\n`, `${LANDING}: own bookkeeping`);
    ctx.tip = head(ctx.root);
    ctx.ownPaths = ownPaths(ctx.root, ctx.tip, [SIBLING, THIRD]);
  });

  scoped(
    /^that path is attributed to the sibling only and excluded as the sibling's, as the send-time gate's shape 2 already decides$/,
    (ctx) => {
      const excluded = ctx.ownPaths.excluded || [];
      const row = excluded.find((e) => e.path === SHARED_PATH);
      assert.ok(row, `expected ${SHARED_PATH} excluded, got: ${JSON.stringify(ctx.ownPaths)}`);
      assert.deepEqual(row.owners.sort(), [SIBLING], `expected the sibling as sole owner, got: ${JSON.stringify(row)}`);
    },
  );

  scoped(
    /^a commit on the reviewing branch touching a path whose subject names the sibling's id and the landing ticket's id and leads with neither$/,
    (ctx) => {
      commitFile(
        ctx.root,
        SHARED_PATH,
        'v1\n',
        `Update the shared doc for ${SIBLING} and ${LANDING}'s chokepoint fold`,
      );
    },
  );

  scoped(/^a commit whose subject leads with the landing ticket's id also touches that path$/, (ctx) => {
    commitFile(ctx.root, SHARED_PATH, 'v2\n', `${LANDING}: own touch on the shared doc`);
  });

  scoped(
    /^that path is kept for the landing ticket with the sibling reported as a passenger, neither excluded nor refused$/,
    (ctx) => {
      assert.equal(ctx.ownPaths.warning, null, `expected no refusal, got: ${JSON.stringify(ctx.ownPaths)}`);
      assert.ok(
        (ctx.ownPaths.paths || []).includes(SHARED_PATH),
        `expected the shared path kept, got: ${JSON.stringify(ctx.ownPaths)}`,
      );
      assert.ok(
        (ctx.ownPaths.passengers || []).includes(SIBLING),
        `expected the sibling as a passenger, got: ${JSON.stringify(ctx.ownPaths)}`,
      );
      assert.ok(
        !(ctx.ownPaths.excluded || []).some((e) => e.path === SHARED_PATH),
        `the shared path must never be excluded, got: ${JSON.stringify(ctx.ownPaths)}`,
      );
    },
  );

  scoped(
    /^a commit on the reviewing branch touching a path whose subject names the sibling's id and a third ticket's id and leads with neither$/,
    (ctx) => {
      writeDoneTicket(ctx.root, THIRD);
      commitFile(
        ctx.root,
        SHARED_PATH,
        'v1\n',
        `Update the shared doc for ${SIBLING} and ${THIRD}'s chokepoint fold`,
      );
    },
  );

  scoped(/^that path's content at the tip differs from origin\/main$/, (ctx) => {
    ctx.tipDiffers = true;
  });

  scoped(/^no commit naming the landing ticket touches that path$/, () => {
    // No-op: the Background/prior steps never gave the landing ticket its
    // own commit on the shared path in this scenario - asserted implicitly
    // by the Then step reading a real refusal rather than a kept path.
  });

  scoped(/^the land step runs for the landing ticket at the tip$/, (ctx) => {
    commitFile(ctx.root, 'backlog/active/BL-9544-fixture.yaml', `id: ${LANDING}\n`, `${LANDING}: own bookkeeping`);
    ctx.tip = head(ctx.root);
    ctx.cli = runCli(ctx.root, ctx.tip);
  });

  scoped(
    /^it exits LAND_ESCALATE and the reason names that commit, both ticket ids its subject names, and the path$/,
    (ctx) => {
      assert.equal(ctx.cli.status, 1, `expected LAND_ESCALATE (exit 1), got: ${JSON.stringify(ctx.cli)}`);
      assert.ok(ctx.cli.stdout.includes('LAND_ESCALATE'), `expected LAND_ESCALATE, got: ${ctx.cli.stdout}`);
      assert.ok(ctx.cli.stdout.includes(SHARED_PATH), `reason does not name the path: ${ctx.cli.stdout}`);
      assert.ok(ctx.cli.stdout.includes(SIBLING), `reason does not name the sibling: ${ctx.cli.stdout}`);
      assert.ok(ctx.cli.stdout.includes(THIRD), `reason does not name the third ticket: ${ctx.cli.stdout}`);
    },
  );

  scoped(/^the path is never printed as an EXCLUDED_SIBLING_PATH$/, (ctx) => {
    assert.ok(
      !ctx.cli.stdout.includes(`EXCLUDED_SIBLING_PATH ${SHARED_PATH}`),
      `the path must never be printed as EXCLUDED_SIBLING_PATH, got: ${ctx.cli.stdout}`,
    );
  });

  scoped(/^that path's content at the tip is identical to origin\/main$/, (ctx) => {
    // origin/main never had this path at all (the Background marks it
    // before the reviewing branch's ambiguous commit creates the file), so
    // "identical to origin/main" here means absent on both sides - deleting
    // it again nets the two-tree diff to nothing for this path, exactly
    // the ::absent-on-both-sides case land_step_lib.bb's own blob-at
    // documents as byte-identical in the only sense that matters.
    const root = ctx.root;
    git(root, 'rm', '-q', SHARED_PATH);
    git(root, 'commit', '-q', '-m', 'the shared doc is removed again, back to origin/main\'s state');
  });

  scoped(/^the land proceeds with no refusal and no exclusion for that path$/, (ctx) => {
    assert.equal(ctx.cli.status, 0, `expected a clean/replay outcome, got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(!ctx.cli.stdout.includes('LAND_ESCALATE'), `expected no escalation, got: ${ctx.cli.stdout}`);
    assert.ok(
      !ctx.cli.stdout.includes(`EXCLUDED_SIBLING_PATH ${SHARED_PATH}`),
      `expected no exclusion of the path, got: ${ctx.cli.stdout}`,
    );
  });
}

module.exports = { registerSteps };
