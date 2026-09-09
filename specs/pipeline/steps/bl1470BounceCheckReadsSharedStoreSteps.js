'use strict';

// BL-1470: the land step's bounce check reads the store record-bounce.js
// actually writes to (the shared target root, BL-1339's own resolution),
// unioned with the caller's own root, whichever checkout asks. Drives the
// REAL land_step_cli.bb as a subprocess with `cwd` set to the checkout
// under test, proving the CLI's own default root resolution
// (`git rev-parse --show-toplevel` of the caller's cwd) end to end - never
// a call straight into land-step-lib's own functions with an explicit
// root, which would prove nothing about the production bug (the CLI's
// default root is the calling worktree, dark to a bounce filed at the
// shared root).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "BL-1470 The land step's bounce check reads the store where bounces are written, from any worktree";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');

const LANDING = 'BL-9001';
const SIBLING = 'BL-9002';
const SHARED_PATH = 'specs/pipeline/steps/index.js';

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

function writeTicket(root, folder, id, extraYaml) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\nstatus: todo\n${extraYaml || ''}`);
}

function writeBounce(root, ticket, commit, at) {
  const dir = path.join(root, '.swarmforge', 'bounces');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, '2026-09.jsonl'),
    JSON.stringify({ ticket, producingRole: 'coder', ticketType: 'defect', failureClass: 'behavior', commit, by: 'QA', at }) + '\n',
  );
}

function writeUnreadableStore(root) {
  const dir = path.join(root, '.swarmforge', 'bounces');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-09.jsonl'), 'not valid json\n');
}

// The linked worktree lives INSIDE the fixture's own repository (BL-1390:
// never `git worktree add` on the live checkout) - a sibling directory of
// the master root, branched off main so it starts with the exact tree the
// tip already carries (tickets, the shared path, both lines).
function linkedWorktree(root) {
  const wt = path.join(root, 'linked-wt');
  git(root, 'worktree', 'add', '-q', '-b', 'bl1470-role', wt, 'main');
  return wt;
}

function runCli(cwd, taskName, commit) {
  const r = spawnSync('bb', [CLI, taskName, commit], { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository with an origin, a linked role worktree of that repository, a landing ticket, and an approved sibling ticket sharing a path$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1470-fixture-');
      git(root, 'init', '-q', '-b', 'main', '.');
      git(root, 'config', 'user.email', 't@t');
      git(root, 'config', 'user.name', 't');
      git(root, 'config', 'commit.gpgsign', 'false');

      writeTicket(root, 'active', LANDING);
      writeTicket(root, 'active', SIBLING, 'human_approval: approved\n');
      fs.mkdirSync(path.join(root, 'specs', 'pipeline', 'steps'), { recursive: true });
      fs.writeFileSync(path.join(root, SHARED_PATH), '// base\n');
      git(root, 'add', '-A');
      git(root, 'commit', '-q', '-m', 'seed the step registry');
      git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

      commitFile(root, SHARED_PATH, '// base\n// landing line\n', `${LANDING}: the landing ticket adds its line`);
      commitFile(
        root, SHARED_PATH, '// base\n// landing line\n// sibling line\n',
        `${SIBLING}: the sibling adds its own line to the same file`,
      );

      ctx.root = root;
      ctx.tip = head(root);
      ctx.worktreeRoot = linkedWorktree(root);
    },
  );

  scoped(
    /^a bounce record for the sibling under the shared root's \.swarmforge\/bounces naming a commit reachable from the tip$/,
    (ctx) => {
      writeBounce(ctx.root, SIBLING, ctx.tip, '2026-09-07T11:48:00.000Z');
    },
  );

  scoped(
    /^a bounce record for the sibling under the linked worktree's own \.swarmforge\/bounces and none under the shared root$/,
    (ctx) => {
      writeBounce(ctx.worktreeRoot, SIBLING, ctx.tip, '2026-09-07T11:48:00.000Z');
    },
  );

  scoped(/^the bounce store under (the shared root|the linked worktree) is unreadable$/, (ctx, where) => {
    writeUnreadableStore(where === 'the shared root' ? ctx.root : ctx.worktreeRoot);
  });

  scoped(/^no \.swarmforge\/bounces directory under the shared root or the linked worktree$/, () => {
    // The fixture already has no bounce store anywhere - nothing further to do.
  });

  scoped(
    /^the land step CLI plans the landing ticket's tip from inside the linked worktree with no explicit root$/,
    (ctx) => {
      ctx.cli = runCli(ctx.worktreeRoot, `${LANDING}-fixture`, ctx.tip);
    },
  );

  scoped(/^the land step CLI plans the landing ticket's tip from the master checkout$/, (ctx) => {
    ctx.cli = runCli(ctx.root, `${LANDING}-fixture`, ctx.tip);
  });

  scoped(/^the land step plans the landing ticket's tip from inside the linked worktree$/, (ctx) => {
    ctx.cli = runCli(ctx.worktreeRoot, `${LANDING}-fixture`, ctx.tip);
  });

  scoped(/^the sibling is reported as blocking, naming the bounce and its commit$/, (ctx) => {
    assert.equal(ctx.cli.status, 1, `expected LAND_ESCALATE (exit 1), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_ESCALATE'), `expected LAND_ESCALATE, got: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(SIBLING), `reason does not name the sibling: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes('bounced'), `reason does not name the bounce: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(ctx.tip), `reason does not name the bounced commit: ${ctx.cli.stdout}`);
  });

  scoped(/^the sibling's approval state is unreadable and blocking, naming the store$/, (ctx) => {
    assert.equal(ctx.cli.status, 1, `expected LAND_ESCALATE (exit 1), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_ESCALATE'), `expected LAND_ESCALATE, got: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(SIBLING), `reason does not name the sibling: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes('unreadable'), `reason does not name the store as unreadable: ${ctx.cli.stdout}`);
  });

  scoped(/^the sibling's approval state is exactly what BL-1375 gives it$/, (ctx) => {
    assert.equal(ctx.cli.status, 0, `expected a clean replay (exit 0), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.cli.stdout}`);
    assert.ok(
      ctx.cli.stdout.includes(`PASSENGER_SIBLING ${SIBLING}`),
      `expected the approved sibling to ride as a passenger, got: ${ctx.cli.stdout}`,
    );
  });
}

module.exports = { registerSteps };
