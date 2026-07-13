'use strict';

// BL-324: step handlers for "The swarm parks roles a ticket does not need
// and brings them back when it does" - drives the REAL role_lifecycle.sh +
// role_lifecycle_cli.bb (real swarmforge.sh config parsing, real tmux
// session create/kill on an ISOLATED per-fixture socket - never the live
// swarm's own socket) for scenarios 01-05, and the real compiled
// measureParkCycleCost (burnRate.ts) directly for scenario 06 - no bash/
// tmux fixture needed there at all, it is a pure function over fixture
// transcript records.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ROLE_LIFECYCLE_SH = path.join(SWARMFORGE_SCRIPTS, 'role_lifecycle.sh');
const ROLE_LIFECYCLE_CLI = path.join(SWARMFORGE_SCRIPTS, 'role_lifecycle_cli.bb');
const SWARMFORGE_SH = path.join(SWARMFORGE_SCRIPTS, 'swarmforge.sh');
const { measureParkCycleCost } = require(path.join(REPO_ROOT, 'extension', 'out', 'metrics', 'burnRate'));

const STANDARD_CHAIN = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const REAL_LAUNCH_ROLES = ['coder', 'cleaner', 'architect', 'QA'];

// Safety net: every fixture root this file creates a REAL isolated tmux
// session for is tracked here and torn down on process exit - never left
// as an orphaned (if isolated) tmux server if an assertion throws mid-
// scenario, mirroring test_role_lifecycle_cli.sh's own trap-based cleanup.
const liveFixtureRoots = new Set();

function cleanupRoot(root) {
  const sock = tmuxSocket(root);
  if (sock) {
    spawnSync('tmux', ['-S', sock, 'kill-server']);
  }
  fs.rmSync(root, { recursive: true, force: true });
  liveFixtureRoots.delete(root);
}

process.on('exit', () => {
  for (const root of liveFixtureRoots) {
    try {
      cleanupRoot(root);
    } catch {
      // best-effort - the process is already exiting
    }
  }
});

function mkFakeBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-role-lifecycle-fakebin-'));
  fs.writeFileSync(path.join(dir, 'claude'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(dir, 'claude'), 0o755);
  return dir;
}

function fakeEnv(fakeBin) {
  return {
    ...process.env,
    SWARMFORGE_CONFIG: undefined,
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
  };
}

function rolesTsvPath(root) {
  return path.join(root, '.swarmforge', 'roles.tsv');
}

function appendRolesTsv(root, row) {
  fs.mkdirSync(path.dirname(rolesTsvPath(root)), { recursive: true });
  fs.appendFileSync(rolesTsvPath(root), row + '\n');
}

function rolesTsvHas(root, role) {
  if (!fs.existsSync(rolesTsvPath(root))) return false;
  return fs
    .readFileSync(rolesTsvPath(root), 'utf8')
    .split('\n')
    .some((line) => line.split('\t')[0] === role);
}

function rowFor(root, role, fakeBin) {
  const result = spawnSync('bash', [ROLE_LIFECYCLE_SH, root, 'row-for', role], { encoding: 'utf8', env: fakeEnv(fakeBin) });
  return result.stdout.trim();
}

function realUnpark(root, role, fakeBin) {
  spawnSync('bash', [ROLE_LIFECYCLE_SH, root, 'unpark', role], { encoding: 'utf8', env: fakeEnv(fakeBin) });
}

function tmuxSocket(root) {
  const result = spawnSync('zsh', ['-c', `source '${SWARMFORGE_SH}' '${root}' >/dev/null 2>&1; echo $TMUX_SOCKET`], { encoding: 'utf8' });
  return result.stdout.trim();
}

function sessionAlive(root, session) {
  const sock = tmuxSocket(root);
  if (!sock) return false;
  const result = spawnSync('tmux', ['-S', sock, 'has-session', '-t', session]);
  return result.status === 0;
}

// Builds an isolated fixture root with the FULL 7-role standard chain
// configured, mirroring test_role_lifecycle_cli.sh's own mk_fixture_root -
// coder/cleaner/architect/QA get REAL tmux sessions on an isolated socket;
// specifier/hardender/documenter get plain roster rows (no scenario here
// parks/unparks them specifically).
function mkFixtureRoot(fakeBin) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-role-lifecycle-'));
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of STANDARD_CHAIN) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  for (const role of REAL_LAUNCH_ROLES.concat(['hardender', 'documenter'])) {
    fs.mkdirSync(path.join(root, '.worktrees', role, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
    fs.mkdirSync(path.join(root, '.worktrees', role, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  }
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'specifier', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'specifier', 'inbox', 'in_process'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    [
      'window specifier claude master --model x',
      'window coder claude coder --model x',
      'window cleaner claude cleaner --model x',
      'window architect claude architect --model x',
      'window hardender claude hardender --model x',
      'window documenter claude documenter --model x',
      'window QA claude QA --model x',
      '',
    ].join('\n')
  );
  for (const role of REAL_LAUNCH_ROLES) {
    const row = rowFor(root, role, fakeBin);
    appendRolesTsv(root, row);
    realUnpark(root, role, fakeBin);
  }
  appendRolesTsv(root, `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\toff`);
  appendRolesTsv(root, `hardender\thardender\t${root}/.worktrees/hardender\tswarmforge-hardender\tHardender\tclaude\ttask\toff`);
  appendRolesTsv(root, `documenter\tdocumenter\t${root}/.worktrees/documenter\tswarmforge-documenter\tDocumenter\tclaude\ttask\toff`);
  appendRolesTsv(root, `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\toff`);
  liveFixtureRoots.add(root);
  return root;
}

function writeTicket(root, id, priority, roles) {
  const p = path.join(root, 'backlog', 'active', `${id}.yaml`);
  const lines = [`id: ${id}`, 'status: todo', `priority: ${priority}`];
  if (roles) lines.push(`roles: [${roles}]`);
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

function writePausedTicket(root, id, priority, roles) {
  const p = path.join(root, 'backlog', 'paused', `${id}.yaml`);
  const lines = [`id: ${id}`, 'status: todo', `priority: ${priority}`];
  if (roles) lines.push(`roles: [${roles}]`);
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

function runShape(root, ticketPath, fakeBin) {
  const result = spawnSync('bb', [ROLE_LIFECYCLE_CLI, root, 'shape', ticketPath], { encoding: 'utf8', env: fakeEnv(fakeBin) });
  return { stdout: result.stdout.trim(), stderr: result.stderr, code: result.status };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a swarm whose roster of expected-alive roles is \.swarmforge\/roles\.tsv$/, (ctx) => {
    ctx.fakeBin = mkFakeBin();
    ctx.root = mkFixtureRoot(ctx.fakeBin);
  });

  registry.define(/^each ticket may declare a roles: manifest naming the roles it needs$/, () => {
    // Structural - the manifest schema itself (BL-317), already exercised
    // by writeTicket/writePausedTicket below.
  });

  // ── per-role-lifecycle-01 ───────────────────────────────────────────────
  registry.define(/^a promoted ticket whose manifest names three roles$/, (ctx) => {
    ctx.ticketPath = writeTicket(ctx.root, 'BL-900', 10, 'coder, cleaner, QA');
  });

  registry.define(/^the swarm is brought to that ticket's shape$/, (ctx) => {
    ctx.result = runShape(ctx.root, ctx.ticketPath, ctx.fakeBin);
  });

  registry.define(/^exactly those three roles and the warm core are alive$/, (ctx) => {
    for (const role of ['coder', 'cleaner', 'QA']) {
      if (!rolesTsvHas(ctx.root, role)) throw new Error(`expected ${role} in roles.tsv, got: ${JSON.stringify(ctx.result)}`);
    }
    if (!rolesTsvHas(ctx.root, 'coordinator')) throw new Error('expected the warm core (coordinator) to stay alive');
    if (!sessionAlive(ctx.root, 'swarmforge-coder')) throw new Error('expected a real live session for coder');
  });

  registry.define(/^the roles the ticket does not need are parked$/, (ctx) => {
    if (rolesTsvHas(ctx.root, 'architect')) throw new Error('expected architect (not in the manifest) to be parked');
  });

  registry.define(/^a parked role is not respawned$/, (ctx) => {
    if (sessionAlive(ctx.root, 'swarmforge-architect')) throw new Error("expected architect's pane to be killed, not respawned");
  });

  // ── per-role-lifecycle-02 ───────────────────────────────────────────────
  registry.define(/^a role that was parked because the previous ticket did not need it$/, (ctx) => {
    const first = writeTicket(ctx.root, 'BL-901', 10, 'coder, QA');
    runShape(ctx.root, first, ctx.fakeBin);
    if (rolesTsvHas(ctx.root, 'architect')) throw new Error('setup failed: expected architect parked by the first ticket');
  });

  registry.define(/^a later ticket whose manifest names that role is promoted$/, (ctx) => {
    ctx.ticketPath = writeTicket(ctx.root, 'BL-902', 10, 'coder, architect, QA');
    ctx.result = runShape(ctx.root, ctx.ticketPath, ctx.fakeBin);
  });

  registry.define(/^that role is brought back up$/, (ctx) => {
    if (!rolesTsvHas(ctx.root, 'architect')) throw new Error('expected architect re-added to roles.tsv');
  });

  registry.define(/^it picks up work normally$/, (ctx) => {
    if (!sessionAlive(ctx.root, 'swarmforge-architect')) throw new Error('expected a real live respawned session for architect');
  });

  // ── per-role-lifecycle-03 ───────────────────────────────────────────────
  registry.define(/^a role holding a claimed parcel in its in_process queue$/, (ctx) => {
    const dir = path.join(ctx.root, '.worktrees', 'cleaner', '.swarmforge', 'handoffs', 'inbox', 'in_process');
    fs.writeFileSync(path.join(dir, '00_x.handoff'), 'from: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: t\ncommit: abc\n\nbody\n');
  });

  registry.define(/^a ticket whose manifest does not name that role$/, (ctx) => {
    ctx.ticketPath = writeTicket(ctx.root, 'BL-903', 10, 'coder, QA');
  });

  registry.define(/^that role is left alive$/, (ctx) => {
    if (!rolesTsvHas(ctx.root, 'cleaner')) throw new Error('expected the busy role (cleaner) left in roles.tsv');
    if (!sessionAlive(ctx.root, 'swarmforge-cleaner')) throw new Error('expected the busy role (cleaner) left with a real live session');
  });

  registry.define(/^its parcel is not orphaned$/, (ctx) => {
    const dir = path.join(ctx.root, '.worktrees', 'cleaner', '.swarmforge', 'handoffs', 'inbox', 'in_process');
    if (!fs.existsSync(path.join(dir, '00_x.handoff'))) throw new Error('expected the in-process parcel to still be present, never orphaned by a park');
  });

  // ── per-role-lifecycle-04 ───────────────────────────────────────────────
  registry.define(/^a promoted ticket whose manifest does not name a role$/, (ctx) => {
    ctx.ticketPath = writeTicket(ctx.root, 'BL-904', 10, 'coder, QA');
  });

  registry.define(/^the next queued ticket's manifest does need that role$/, (ctx) => {
    writePausedTicket(ctx.root, 'BL-905', 20, 'coder, architect, QA');
  });

  registry.define(/^that role is left alive rather than parked and immediately restarted$/, (ctx) => {
    ctx.result = runShape(ctx.root, ctx.ticketPath, ctx.fakeBin);
    if (!rolesTsvHas(ctx.root, 'architect')) throw new Error('expected architect (needed by the next queued ticket) left in roles.tsv');
    if (!sessionAlive(ctx.root, 'swarmforge-architect')) throw new Error('expected architect left with its ORIGINAL live session, never torn down and rebuilt');
  });

  // ── per-role-lifecycle-05 ───────────────────────────────────────────────
  registry.define(/^a promoted ticket that declares no roles: manifest$/, (ctx) => {
    ctx.ticketPath = writeTicket(ctx.root, 'BL-906', 10, '');
  });

  registry.define(/^every role in the full standard chain is alive$/, (ctx) => {
    for (const role of STANDARD_CHAIN) {
      if (!rolesTsvHas(ctx.root, role)) throw new Error(`expected ${role} alive (full chain), got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^no role is parked$/, (ctx) => {
    if (ctx.result.stdout !== '{"parked":[],"unparked":[]}') {
      throw new Error(`expected no parks/unparks at all, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── per-role-lifecycle-06: burn-rate cost measurement ───────────────────
  registry.define(/^a role has been parked and later brought back up$/, (ctx) => {
    ctx.parkedAtMs = Date.parse('2026-07-13T08:00:00Z');
    ctx.unparkedAtMs = ctx.parkedAtMs + 60 * 60 * 1000;
    ctx.coldStartWindowMs = 5 * 60 * 1000;
    ctx.priorIdleWindowMs = 15 * 60 * 1000;
    ctx.records = [
      {
        messageId: 'prior-idle',
        timestampMs: ctx.parkedAtMs - 5 * 60 * 1000,
        model: 'claude-sonnet-5',
        usage: { inputTokens: 1, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      },
      {
        messageId: 'cold-start',
        timestampMs: ctx.unparkedAtMs + 1000,
        model: 'claude-sonnet-5',
        usage: { inputTokens: 5000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      },
    ];
  });

  registry.define(/^the cost of that park cycle is measured against leaving the role warm and idle$/, (ctx) => {
    ctx.report = measureParkCycleCost(ctx.records, ctx.parkedAtMs, ctx.unparkedAtMs, ctx.coldStartWindowMs, ctx.priorIdleWindowMs);
  });

  registry.define(/^the measured token delta is reported$/, (ctx) => {
    if (typeof ctx.report.deltaTokens !== 'number' || Number.isNaN(ctx.report.deltaTokens)) {
      throw new Error(`expected a real numeric delta, got: ${JSON.stringify(ctx.report)}`);
    }
  });

  registry.define(/^a delta showing the churn cost more than it saved is reported as a loss$/, (ctx) => {
    if (!(ctx.report.deltaTokens < 0) || ctx.report.isLoss !== true) {
      throw new Error(`expected a negative delta reported as a loss, got: ${JSON.stringify(ctx.report)}`);
    }
  });
}

module.exports = { registerSteps };
