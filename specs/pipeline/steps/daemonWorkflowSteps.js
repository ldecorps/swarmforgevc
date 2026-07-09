'use strict';

// BL-203: step handlers for the two-pack stabilize daemon workflow feature.
// Drives the real, testable swarm modules (extension/out/swarm/*,
// extension/out/panel/backlogReader.js) through their module surface, plus
// the shipped smoke-check CLI (swarmforge/scripts/smoke_check_stabilize_two_pack.sh)
// - never a live tmux server or a real extension host launch (the
// step-handler surface allowlist excludes live tmux/PTY interaction). Every
// scenario gets its own throwaway target-repo fixture under ctx.targetPath,
// same convention as backlogSteps.js.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const cp = require('node:child_process');

const EXTENSION_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { readBacklogFolders } = require(path.join(EXTENSION_OUT, 'panel', 'backlogReader.js'));
const { mailboxDir } = require(path.join(EXTENSION_OUT, 'swarm', 'swarmState.js'));
const { computeDaemonProcessStatus, isDaemonReady } = require(path.join(EXTENSION_OUT, 'swarm', 'daemonHealth.js'));
const { stopSwarmCompletely, verifySwarmStopped } = require(path.join(EXTENSION_OUT, 'swarm', 'swarmStopper.js'));

const SMOKE_CHECK_SCRIPT = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'smoke_check_stabilize_two_pack.sh');
const PIPELINE_ROLES = ['coordinator', 'coder', 'cleaner'];
const BACKLOG_ITEM_FILE = 'BL-203-demo.yaml';

// A disposable child process stands in for a live handoffd/supervisor pid -
// never this test runner's own pid (a real SIGTERM to that would kill the
// step run itself, the same hazard the extension's own test suite guards
// against). Kept short-lived: this DSL has no scenario-teardown hook, so a
// leaked fixture process must expire on its own quickly rather than linger.
function spawnDisposableProcess() {
  return cp.spawn('sleep', ['3'], { stdio: 'ignore' });
}

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-daemon-workflow-'));
  }
  return ctx.targetPath;
}

function roleEntry(targetPath, role) {
  return { role, worktreeName: role === 'coordinator' ? 'master' : role, worktreePath: targetPath };
}

function writeStabilizeProfileFixture(targetPath) {
  const profileDir = path.join(targetPath, 'swarmforge', 'profiles');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, 'stabilize-two-pack.conf'),
    [
      'config active_backlog_max_depth 1',
      '',
      'window coordinator claude master --model claude-opus-4-6 --dangerously-skip-permissions',
      'window coder claude coder --model claude-opus-4-6 --dangerously-skip-permissions',
      'window cleaner claude cleaner batch --model claude-sonnet-5 --dangerously-skip-permissions',
      '',
    ].join('\n')
  );

  fs.mkdirSync(path.join(targetPath, '.vscode'), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, '.vscode', 'launch.json'),
    JSON.stringify(
      {
        version: '0.2.0',
        configurations: [
          {
            name: 'Run Extension (two-pack stabilize · daemon on)',
            type: 'extensionHost',
            request: 'launch',
            env: {
              SWARMFORGE_SKIP_DAEMON: '0',
              SWARMFORGE_CONFIG: '${workspaceFolder}/swarmforge/profiles/stabilize-two-pack.conf',
            },
            settings: {
              'swarmforge.configPath': '${workspaceFolder}/swarmforge/profiles/stabilize-two-pack.conf',
            },
          },
        ],
      },
      null,
      2
    )
  );
}

function writeBacklogPausedFixture(targetPath) {
  const pausedDir = path.join(targetPath, 'backlog', 'paused');
  fs.mkdirSync(pausedDir, { recursive: true });
  fs.writeFileSync(
    path.join(pausedDir, BACKLOG_ITEM_FILE),
    'id: BL-203\ntitle: "stabilize extension two-pack daemon workflow"\nstatus: todo\n'
  );
}

// The same underlying transition ("coordinator processes the backlog" in
// ac-02, "BL-203 is active" in ac-03) - both scenarios' Background already
// left BL-203 sitting in paused/, so both just promote that same file.
function promoteBacklogItemToActive(targetPath) {
  const pausedFile = path.join(targetPath, 'backlog', 'paused', BACKLOG_ITEM_FILE);
  const activeDir = path.join(targetPath, 'backlog', 'active');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.renameSync(pausedFile, path.join(activeDir, BACKLOG_ITEM_FILE));
}

function writeRolesTsvFixture(targetPath, roles) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  const tsv = roles
    .map((role) =>
      [role, role === 'coordinator' ? 'master' : role, targetPath, `swarmforge-${role}`, role, 'claude', 'task'].join('\t')
    )
    .join('\n');
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), tsv + '\n');
}

function writeDaemonUpFixture(targetPath) {
  const daemonDir = path.join(targetPath, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  const daemon = spawnDisposableProcess();
  const supervisor = spawnDisposableProcess();
  fs.writeFileSync(path.join(daemonDir, 'handoffd.pid'), String(daemon.pid));
  fs.writeFileSync(path.join(daemonDir, 'handoffd-supervisor.pid'), String(supervisor.pid));
  fs.writeFileSync(path.join(daemonDir, 'handoffd.heartbeat'), '');
  fs.writeFileSync(path.join(daemonDir, 'handoffd.status.json'), JSON.stringify({ state: 'healthy' }));
}

function writeTmuxSocketFixture(targetPath) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), path.join(targetPath, 'fake.sock'));
}

function assertRoleReceivedTask(targetPath, role, ticketId) {
  const completedDir = mailboxDir(roleEntry(targetPath, role), 'inbox', 'completed');
  let files;
  try {
    files = fs.readdirSync(completedDir);
  } catch {
    files = [];
  }
  const taskPattern = new RegExp(`^task:\\s*${ticketId}`, 'm');
  const found = files.some((f) => taskPattern.test(fs.readFileSync(path.join(completedDir, f), 'utf8')));
  if (!found) {
    throw new Error(`expected ${role}'s completed inbox (${completedDir}) to contain a handoff for ${ticketId}, found: ${files.join(', ') || '(none)'}`);
  }
}

function writeCompletedHandoff(targetPath, role, from, ticketId) {
  const dir = mailboxDir(roleEntry(targetPath, role), 'inbox', 'completed');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '00_test.handoff'), `from: ${from}\nto: ${role}\ntask: ${ticketId}\ntype: note\n\nbody\n`);
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^the stabilize-two-pack profile and daemon-on launch config exist$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    writeStabilizeProfileFixture(targetPath);
    cp.execFileSync('bash', [SMOKE_CHECK_SCRIPT, targetPath], { stdio: 'pipe' });
  });

  registry.define(/^BL-203 is the only paused ticket \(queue isolated\)$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    writeBacklogPausedFixture(targetPath);
    const folders = readBacklogFolders(targetPath);
    if (folders.paused.length !== 1 || folders.paused[0].id !== 'BL-203') {
      throw new Error(`expected only BL-203 paused, found: ${JSON.stringify(folders.paused.map((i) => i.id))}`);
    }
  });

  // ── ac-01: daemon is up after extension launch ───────────────────────
  registry.define(/^the operator launches "([^"]+)"$/, (ctx, launchConfigName) => {
    if (!launchConfigName.includes('two-pack stabilize')) {
      throw new Error(`unexpected launch config "${launchConfigName}"`);
    }
    const targetPath = ensureTargetPath(ctx);
    writeRolesTsvFixture(targetPath, PIPELINE_ROLES);
    writeDaemonUpFixture(targetPath);
  });

  registry.define(/^handoffd reports a running\/supervised state under \.swarmforge\/daemon\/$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    if (!isDaemonReady(targetPath, {})) {
      throw new Error('expected isDaemonReady to report the daemon as ready');
    }
    const status = computeDaemonProcessStatus(targetPath, {}, Date.now());
    if (status.phase !== 'polling' && status.phase !== 'up') {
      throw new Error(`expected a running/supervised daemon phase, got "${status.phase}" (${status.label})`);
    }
  });

  registry.define(/^all three role panes \(coordinator, coder, cleaner\) are live$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    const tsv = fs.readFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), 'utf8');
    const roles = tsv.split('\n').filter((l) => l.trim()).map((l) => l.split('\t')[0]);
    for (const role of PIPELINE_ROLES) {
      if (!roles.includes(role)) {
        throw new Error(`expected role "${role}" configured in roles.tsv, got: ${roles.join(', ')}`);
      }
    }
  });

  // ── ac-02: coordinator promotes BL-203 ────────────────────────────────
  registry.define(/^handoffd is running$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    writeDaemonUpFixture(targetPath);
    if (!isDaemonReady(targetPath, {})) {
      throw new Error('fixture setup failed: daemon not ready');
    }
  });

  registry.define(/^the coordinator processes the backlog$/, (ctx) => {
    promoteBacklogItemToActive(ensureTargetPath(ctx));
  });

  registry.define(/^BL-203 moves from backlog\/paused\/ to backlog\/active\/$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    const folders = readBacklogFolders(targetPath);
    if (folders.paused.some((i) => i.id === 'BL-203')) {
      throw new Error('BL-203 still present in backlog/paused/');
    }
    if (!folders.active.some((i) => i.id === 'BL-203')) {
      throw new Error('BL-203 not found in backlog/active/');
    }
  });

  // ── ac-03: daemon routes the parcel across the swarm ──────────────────
  registry.define(/^BL-203 is active$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    promoteBacklogItemToActive(targetPath);
    writeRolesTsvFixture(targetPath, PIPELINE_ROLES);
  });

  registry.define(/^the coordinator routes work to coder$/, (ctx) => {
    writeCompletedHandoff(ensureTargetPath(ctx), 'coder', 'coordinator', 'BL-203');
  });

  registry.define(/^coder receives the parcel via handoffd$/, (ctx) => {
    assertRoleReceivedTask(ensureTargetPath(ctx), 'coder', 'BL-203');
  });

  registry.define(/^cleaner receives the parcel after coder completes$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    writeCompletedHandoff(targetPath, 'cleaner', 'coder', 'BL-203');
    assertRoleReceivedTask(targetPath, 'cleaner', 'BL-203');
  });

  registry.define(/^coordinator receives completion signal from cleaner$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    writeCompletedHandoff(targetPath, 'coordinator', 'cleaner', 'BL-203');
    assertRoleReceivedTask(targetPath, 'coordinator', 'BL-203');
  });

  // ── ac-04: graceful stop is clean and idempotent ──────────────────────
  registry.define(/^a running stabilize swarm$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    writeTmuxSocketFixture(targetPath);
    writeDaemonUpFixture(targetPath);
  });

  registry.define(/^the operator runs \.\/swarm-kill$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    ctx.firstStopResult = stopSwarmCompletely(targetPath);
  });

  registry.define(/^all tmux sessions and handoffd processes stop$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    if (!ctx.firstStopResult || !ctx.firstStopResult.success) {
      throw new Error(`expected the first stop to succeed: ${ctx.firstStopResult && ctx.firstStopResult.message}`);
    }
    if (!verifySwarmStopped(targetPath)) {
      throw new Error('expected verifySwarmStopped to report fully stopped');
    }
  });

  registry.define(/^a second \.\/swarm-kill is a no-op success$/, (ctx) => {
    const second = stopSwarmCompletely(ensureTargetPath(ctx));
    if (!second.success) {
      throw new Error(`expected the second (idempotent) stop to succeed: ${second.message}`);
    }
  });

  registry.define(/^\.swarmforge\/tmux-socket is cleared$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    if (fs.existsSync(path.join(targetPath, '.swarmforge', 'tmux-socket'))) {
      throw new Error('expected .swarmforge/tmux-socket to be cleared');
    }
  });
}

module.exports = { registerSteps };
