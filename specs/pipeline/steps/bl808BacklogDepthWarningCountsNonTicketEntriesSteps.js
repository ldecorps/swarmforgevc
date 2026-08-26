'use strict';

// BL-808: step handlers for "the backlog depth warning counts tickets, not
// directory entries". Drives the real swarm_handoff.bb WARNING path and the
// shared backlog-depth-lib/count-active-tickets counter against an isolated
// fixture — never a live swarm. All registrations are defineScoped so they
// cannot shadow BL-216's backlogDepthSteps.js (or vice versa).

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'the backlog depth warning counts tickets, not directory entries';

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SWARMFORGE_SCRIPTS, 'swarm_handoff.bb');
const BACKLOG_DEPTH_LIB = path.join(SWARMFORGE_SCRIPTS, 'backlog_depth_lib.bb');
const PROMOTION_GATES_LIB = path.join(SWARMFORGE_SCRIPTS, 'promotion_gates_lib.bb');

const OUTCOMES = new Set(['silent', 'warned']);

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function ensureFixture(ctx) {
  if (ctx.bl808) {
    return ctx.bl808;
  }
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl808-depth-'));
  git(targetPath, ['init', '-q']);
  git(targetPath, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${targetPath}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`
  );
  const activeDir = path.join(targetPath, 'backlog', 'active');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.writeFileSync(path.join(activeDir, '.gitkeep'), '');
  ctx.bl808 = { targetPath, activeDir, ticketCount: 0 };
  return ctx.bl808;
}

function writeConf(ctx, cap) {
  const { targetPath } = ensureFixture(ctx);
  fs.mkdirSync(path.join(targetPath, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'swarmforge', 'swarmforge.conf'), `config active_backlog_max_depth ${cap}\n`);
}

function setTicketYamls(ctx, n) {
  const st = ensureFixture(ctx);
  for (const name of fs.readdirSync(st.activeDir)) {
    if (name.endsWith('.yaml')) {
      fs.unlinkSync(path.join(st.activeDir, name));
    }
  }
  for (let i = 1; i <= n; i++) {
    fs.writeFileSync(path.join(st.activeDir, `BL-${i}-demo.yaml`), `id: BL-${i}\ntitle: "demo"\nstatus: active\n`);
  }
  st.ticketCount = n;
}

function runSwarmHandoff(ctx) {
  const { targetPath } = ensureFixture(ctx);
  const draft = path.join(targetPath, 'draft.txt');
  fs.writeFileSync(draft, 'type: awake\nto: coordinator\npriority: 50\n');
  const env = {
    ...process.env,
    SWARMFORGE_ROLE: 'coordinator',
    SWARMFORGE_SKIP_SYNC_INJECT: '1',
  };
  const result = spawnSync('bb', [SWARM_HANDOFF, draft], { cwd: targetPath, encoding: 'utf8', env });
  return (result.stdout || '') + (result.stderr || '');
}

function countActiveTicketsViaLib(activeDir) {
  return execFileSync(
    'bb',
    ['-e', `(load-file "${BACKLOG_DEPTH_LIB}") (println (backlog-depth-lib/count-active-tickets "${activeDir}"))`],
    { encoding: 'utf8' }
  ).trim();
}

function promotionGateActiveCount(root) {
  return execFileSync(
    'bb',
    [
      '-e',
      `(load-file "${PROMOTION_GATES_LIB}") (println (promotion-gates-lib/active-count "${root}"))`,
    ],
    { encoding: 'utf8' }
  ).trim();
}

function registerSteps(registry) {
  scoped(registry, /^a backlog\/active\/ directory containing the tracked \.gitkeep placeholder$/, (ctx) => {
    ensureFixture(ctx);
  });

  scoped(registry, /^the active backlog cap is (-?\d+)$/, (ctx, cap) => {
    writeConf(ctx, cap);
  });

  scoped(registry, /^(\d+) ticket yamls? are active$/, (ctx, count) => {
    setTicketYamls(ctx, Number(count));
  });

  scoped(registry, /^the active directory also contains (.+)$/, (ctx, entry) => {
    const { activeDir } = ensureFixture(ctx);
    if (entry === 'a README.md file') {
      fs.writeFileSync(path.join(activeDir, 'README.md'), '# not a ticket\n');
      return;
    }
    if (entry === 'a nested directory') {
      fs.mkdirSync(path.join(activeDir, 'nested-extra'), { recursive: true });
      return;
    }
    throw new Error(`unknown non-ticket entry fixture: ${entry}`);
  });

  scoped(registry, /^a handoff is sent$/, (ctx) => {
    ctx.bl808.handoffOutput = runSwarmHandoff(ctx);
  });

  scoped(registry, /^the depth warning outcome is (silent|warned)$/, (ctx, outcome) => {
    if (!OUTCOMES.has(outcome)) {
      throw new Error(`outcome must be silent|warned, got: ${outcome}`);
    }
    const warned = /Active backlog depth exceeded/i.test(ctx.bl808.handoffOutput || '');
    if (outcome === 'warned' && !warned) {
      throw new Error(`expected a depth warning, got: ${ctx.bl808.handoffOutput}`);
    }
    if (outcome === 'silent' && warned) {
      throw new Error(`expected no depth warning, got: ${ctx.bl808.handoffOutput}`);
    }
  });

  scoped(registry, /^it reports the active count as (\d+)$/, (ctx, expected) => {
    const m = /Active backlog depth exceeded \(active=(\d+), max=/.exec(ctx.bl808.handoffOutput || '');
    if (!m) {
      throw new Error(`expected a depth warning naming active count, got: ${ctx.bl808.handoffOutput}`);
    }
    if (m[1] !== expected) {
      throw new Error(`expected active=${expected}, got active=${m[1]} in: ${ctx.bl808.handoffOutput}`);
    }
  });

  scoped(registry, /^the depth warning's active count and the promotion gate's active count are compared$/, (ctx) => {
    const { targetPath, activeDir } = ensureFixture(ctx);
    ctx.bl808.warningCount = countActiveTicketsViaLib(activeDir);
    ctx.bl808.gateCount = promotionGateActiveCount(targetPath);
  });

  scoped(registry, /^the two counts are equal$/, (ctx) => {
    if (ctx.bl808.warningCount !== ctx.bl808.gateCount) {
      throw new Error(
        `warning count (${ctx.bl808.warningCount}) !== promotion-gate count (${ctx.bl808.gateCount})`
      );
    }
  });
}

module.exports = { registerSteps };
