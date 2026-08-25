'use strict';

// BL-1115: stamp-off of Cursor hotfix a3bf11b533. Confirms the landed
// main_sync_status_cli.bb range+binding (origin/main...main → [behind ahead])
// and drives the REAL CLI against a hermetic ahead/behind fixture. Never
// reimplements the hotfix; never writes Hotfix-Certification certified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1115 stamp-off of Cursor hotfix a3bf11b533';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'main_sync_status_cli.bb');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');
const HOTFIX_SHA = 'a3bf11b533';

const KNOWN_ACTIONS = new Set(['proceed', 'ff-only', 'wait-reconcile', 'deadlock-tripped']);
const KNOWN_DEADLOCK = new Set(['clear', 'active']);

function git(cwd, args, opts = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'bl1115',
      GIT_AUTHOR_EMAIL: 'bl1115@test',
      GIT_COMMITTER_NAME: 'bl1115',
      GIT_COMMITTER_EMAIL: 'bl1115@test',
    },
    ...opts,
  });
}

function commitFile(cwd, name, body, msg) {
  fs.writeFileSync(path.join(cwd, name), body);
  git(cwd, ['add', name]);
  git(cwd, ['commit', '-m', msg]);
}

/** Build a repo where local main is `ahead` commits ahead and `behind` behind origin/main. */
function makeAheadBehindFixture(ahead, behind) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1115-sync-'));
  const bare = path.join(base, 'origin.git');
  const work = path.join(base, 'work');
  fs.mkdirSync(bare);
  git(bare, ['init', '--bare', '-b', 'main']);
  git(base, ['clone', bare, work]);
  commitFile(work, 'seed.txt', 'seed\n', 'seed');
  git(work, ['push', 'origin', 'main']);

  // Diverging origin-only commits (behind from local's POV after we branch).
  if (behind > 0) {
    const other = path.join(base, 'origin-work');
    git(base, ['clone', bare, other]);
    for (let i = 0; i < behind; i++) {
      commitFile(other, `behind-${i}.txt`, `b${i}\n`, `behind ${i}`);
    }
    git(other, ['push', 'origin', 'main']);
  }

  // Local-only commits (ahead).
  if (ahead > 0) {
    // If origin moved, local is behind until we fetch — keep local tip and add ahead commits first.
    for (let i = 0; i < ahead; i++) {
      commitFile(work, `ahead-${i}.txt`, `a${i}\n`, `ahead ${i}`);
    }
  }

  // Fetch so origin/main is visible; do not merge (preserve ahead/behind).
  git(work, ['fetch', 'origin', 'main']);
  // Ensure local branch is named main.
  const branch = git(work, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch !== 'main') {
    git(work, ['branch', '-M', 'main']);
  }

  fs.mkdirSync(path.join(work, '.swarmforge', 'daemon'), { recursive: true });
  return { base, work };
}

function writeDeadlock(work, active) {
  const p = path.join(work, '.swarmforge', 'daemon', 'main-sync-deadlock.json');
  if (!active) {
    fs.writeFileSync(p, '{}');
    return;
  }
  fs.writeFileSync(
    p,
    JSON.stringify({ active: true, alerted: true, ahead: 3, behind: 1, reason: 'diverged' })
  );
}

function runCli(work) {
  const out = execFileSync('bb', [CLI, work], {
    encoding: 'utf8',
    // fetch against local bare may warn; CLI still exits 0 when rev-list works
  });
  const line = out
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .pop();
  assert.ok(line, `expected JSON from CLI, got: ${JSON.stringify(out)}`);
  return JSON.parse(line);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // required_wiring needle
  scoped(/^bl1115MainSyncStatusCliStampOffSteps acceptance handler is registered$/, () => {
    const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    assert.ok(
      idx.includes('bl1115MainSyncStatusCliStampOffSteps'),
      'expected bl1115MainSyncStatusCliStampOffSteps registered in index.js'
    );
  });

  // ── rev-list-range-matches-handoffd-01 ────────────────────────────────
  scoped(/^the source of swarmforge\/scripts\/main_sync_status_cli\.bb$/, (ctx) => {
    ctx.cliSrc = fs.readFileSync(CLI, 'utf8');
    ctx.handoffdSrc = fs.readFileSync(HANDOFFD, 'utf8');
  });

  scoped(/^the rev-counts helper is inspected$/, (ctx) => {
    assert.ok(ctx.cliSrc.includes('rev-counts!'));
  });

  scoped(/^it runs git rev-list --left-right --count origin\/main\.\.\.main$/, (ctx) => {
    assert.match(
      ctx.cliSrc,
      /rev-list"\s+"--left-right"\s+"--count"\s+"origin\/main\.\.\.main"/
    );
    // Same range string as handoffd.
    assert.ok(
      ctx.handoffdSrc.includes('origin/main...main'),
      'handoffd must still use origin/main...main'
    );
    // Stamp confirms tip CLI matches the landed hotfix blob (cherry-pick or same content).
    execFileSync(
      'git',
      [
        'diff',
        '--quiet',
        `${HOTFIX_SHA}:swarmforge/scripts/main_sync_status_cli.bb`,
        'HEAD:swarmforge/scripts/main_sync_status_cli.bb',
      ],
      { cwd: REPO_ROOT }
    );
  });

  scoped(/^it binds the left count as behind and the right count as ahead$/, (ctx) => {
    assert.match(ctx.cliSrc, /\[behind ahead\]/);
    // Must not use the inverted range that caused the bug.
    assert.doesNotMatch(
      ctx.cliSrc,
      /rev-list"\s+"--left-right"\s+"--count"\s+"main\.\.\.origin\/main"/
    );
  });

  // ── absorbed-origin-proceed-02 ───────────────────────────────────────
  scoped(/^local main is (\d+) ahead and (\d+) behind origin\/main$/, (ctx, ahead, behind) => {
    ctx.ahead = Number(ahead);
    ctx.behind = Number(behind);
  });

  scoped(/^the deadlock marker is (clear|active)$/, (ctx, deadlock) => {
    assert.ok(KNOWN_DEADLOCK.has(deadlock), `unknown deadlock ${deadlock}`);
    ctx.deadlock = deadlock;
  });

  scoped(/^main_sync_status_cli reports sync status$/, (ctx) => {
    const { base, work } = makeAheadBehindFixture(ctx.ahead, ctx.behind);
    ctx.fixtureBase = base;
    writeDeadlock(work, ctx.deadlock === 'active');
    ctx.report = runCli(work);
    ctx.reportedAhead = ctx.report.ahead;
    ctx.reportedBehind = ctx.report.behind;
    ctx.action = ctx.report.action;
  });

  scoped(/^the reported behind is (\d+)$/, (ctx, behind) => {
    assert.equal(ctx.reportedBehind, Number(behind));
  });

  scoped(/^the reported ahead is (\d+)$/, (ctx, ahead) => {
    assert.equal(ctx.reportedAhead, Number(ahead));
  });

  scoped(/^the action is (\S+)$/, (ctx, action) => {
    assert.ok(KNOWN_ACTIONS.has(action), `unknown action ${action}`);
    assert.equal(ctx.action, action);
    if (ctx.fixtureBase) {
      try {
        fs.rmSync(ctx.fixtureBase, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      ctx.fixtureBase = undefined;
    }
  });
}

module.exports = { registerSteps };
