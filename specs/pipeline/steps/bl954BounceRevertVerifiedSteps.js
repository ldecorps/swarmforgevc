'use strict';

// BL-954: step handlers for "A recorded bounce verifies its own revert".
// Drives the REAL record-bounce.js CLI as a subprocess over a fixture repo
// (never the live worktrees, never a reimplementation of the check) - the
// wiring itself is under test: a green unit suite over an unreachable
// helper is the BL-419 shape this ticket's required_wiring refuses.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'extension', 'out', 'tools', 'record-bounce.js');

const FEATURE = 'A recorded bounce verifies its own revert';

const BOUNCING_ROLE = 'architect';
const BRANCH = 'swarmforge-architect';

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl954-accept-'));
  trackedRoots.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'base\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  git(root, ['checkout', '-q', '-b', BRANCH]);
  fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'bounced content\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'BL-990: the bounced change']);
  ctx.root = root;
  ctx.bounced = git(root, ['rev-parse', 'HEAD']);
  ctx.by = BOUNCING_ROLE;
  git(root, ['checkout', '-q', 'main']);
}

// KNOWN_VALUES per Scenario Outline row - an unknown token throws.
const CONTENT_STATES = {
  live: () => {},
  reverted: (ctx) => {
    git(ctx.root, ['checkout', '-q', BRANCH]);
    git(ctx.root, ['revert', '--no-edit', ctx.bounced]);
    git(ctx.root, ['checkout', '-q', 'main']);
  },
};

const MAIN_STATES = {
  not: () => {},
  already: (ctx) => {
    git(ctx.root, ['merge', '-q', '--no-edit', ctx.bounced]);
  },
};

const OBSTACLES = {
  'the bounced commit': (ctx) => {
    ctx.bounced = 'ffffffffffffffffffffffffffffffffffffffff';
    ctx.obstacleCausePattern = /ffffffff/;
  },
  'the bouncing branch': (ctx) => {
    ctx.by = 'documenter'; // fixture has no swarmforge-documenter branch
    ctx.obstacleCausePattern = /swarmforge-documenter/;
  },
};

const REMEDIES = {
  'revert-command': (report) => {
    assert.match(report.remedy, /git revert/, `expected a revert command remedy, got ${JSON.stringify(report)}`);
  },
  none: (report) => {
    assert.equal(report.remedy, null, `expected no remedy, got ${JSON.stringify(report)}`);
  },
};

function recordBounce(ctx) {
  const env = { ...process.env };
  delete env.SWARMFORGE_ROLE;
  delete env.SWARMFORGE_CONFIG;
  const stdout = execFileSync(
    'node',
    [
      CLI,
      '--ticket', 'BL-990',
      '--role', 'coder',
      '--type', 'defect',
      '--class', 'behavior',
      '--commit', ctx.bounced.slice(0, 10),
      '--by', ctx.by,
    ],
    { cwd: ctx.root, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  ctx.result = JSON.parse(stdout);
}

function durableRecords(ctx) {
  const dir = path.join(ctx.root, '.swarmforge', 'bounces');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) =>
      fs
        .readFileSync(path.join(dir, f), 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line))
    );
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a bouncing role branch and a commit that role has bounced$/,
    (ctx) => {
      mkFixture(ctx);
    },
    FEATURE
  );

  // ── Givens ───────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the bounced commit's content is (\w+) in the bouncing branch$/,
    (ctx, contentState) => {
      const apply = CONTENT_STATES[contentState];
      if (!apply) throw new Error(`unknown <content_state> token: ${contentState}`);
      apply(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the bounced commit is (\w+) an ancestor of main$/,
    (ctx, mainState) => {
      const apply = MAIN_STATES[mainState];
      if (!apply) throw new Error(`unknown <main_state> token: ${mainState}`);
      apply(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the bounced commit is still an ancestor of the bouncing branch$/,
    (ctx) => {
      execFileSync('git', ['merge-base', '--is-ancestor', ctx.bounced, BRANCH], { cwd: ctx.root });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the bounce revert check cannot resolve (the bounced commit|the bouncing branch)$/,
    (ctx, obstacle) => {
      OBSTACLES[obstacle](ctx);
    },
    FEATURE
  );

  // ── When ─────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the bounce is recorded and the bounce revert check runs$/,
    (ctx) => {
      recordBounce(ctx);
    },
    FEATURE
  );

  // ── Thens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^it reports "([^"]+)"$/,
    (ctx, verdict) => {
      assert.equal(
        ctx.result.revertCheck.verdict,
        verdict,
        `expected verdict ${verdict}, got ${JSON.stringify(ctx.result.revertCheck)}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the remedy it offers is "([^"]+)"$/,
    (ctx, remedy) => {
      const check = REMEDIES[remedy];
      if (!check) throw new Error(`unknown <remedy> token: ${remedy}`);
      check(ctx.result.revertCheck);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the bounce record is present in the durable bounce store$/,
    (ctx) => {
      const records = durableRecords(ctx);
      assert.equal(records.length, 1, `expected exactly one durable record, got ${JSON.stringify(records)}`);
      assert.equal(records[0].ticket, 'BL-990');
    },
    FEATURE
  );

  registry.defineScoped(
    /^it names (the bounced commit|the bouncing branch) as the cause$/,
    (ctx) => {
      assert.match(
        ctx.result.revertCheck.cause,
        ctx.obstacleCausePattern,
        `expected the cause to name the obstacle, got ${JSON.stringify(ctx.result.revertCheck)}`
      );
    },
    FEATURE
  );
}

module.exports = { registerSteps };
