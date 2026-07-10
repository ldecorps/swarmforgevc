'use strict';

// BL-092: step handlers for the second-swarm remote wake-up bridge
// feature. There is no real GitHub Actions runner in this test
// environment, so "the workflow run completes" is simulated by running the
// SAME two scripts the real workflow YAML invokes, in the same order -
// remote_wakeup_periodic_pull.sh (sync) then remote_wakeup_nudge.bb
// (decide + nudge, driven through a fake tmux so no live session is
// needed, same pattern as test_remote_wakeup_nudge.sh). Never a live
// tmux/GitHub connection.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const NUDGE = path.join(SWARMFORGE_SCRIPTS, 'remote_wakeup_nudge.bb');
const PERIODIC_PULL = path.join(SWARMFORGE_SCRIPTS, 'remote_wakeup_periodic_pull.sh');
const WORKFLOW_YAML = path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'second-swarm-wakeup.yml');

const TARGET_SWARM = 'second';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function ensureUpstreamAndClone(ctx) {
  if (ctx.upstream) {
    return;
  }
  ctx.upstream = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-remote-wakeup-upstream-'));
  git(ctx.upstream, ['init', '-q']);
  git(ctx.upstream, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  git(ctx.upstream, ['branch', '-m', 'main']);

  ctx.remoteCheckout = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-remote-wakeup-clone-'));
  execFileSync('git', ['clone', '-q', ctx.upstream, ctx.remoteCheckout], { encoding: 'utf8' });

  fs.mkdirSync(path.join(ctx.remoteCheckout, '.swarmforge'), { recursive: true });
  const sock = path.join(ctx.remoteCheckout, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.writeFileSync(path.join(ctx.remoteCheckout, '.swarmforge', 'tmux-socket'), sock);
  fs.writeFileSync(
    path.join(ctx.remoteCheckout, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${ctx.remoteCheckout}\tswarmforge-second-specifier\tSpecifier\tclaude\ttask\n`
  );

  ctx.fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-remote-wakeup-bin-'));
  ctx.tmuxCallLog = path.join(ctx.fakeBin, 'tmux-calls.log');
  fs.writeFileSync(ctx.tmuxCallLog, '');
  fs.writeFileSync(
    path.join(ctx.fakeBin, 'tmux'),
    `#!/usr/bin/env bash\necho "$@" >> "${ctx.tmuxCallLog}"\ncase "$*" in\n  *capture-pane*) echo '$ ' ;;\n  *) exit 0 ;;\nesac\n`,
    { mode: 0o755 }
  );
}

function pushCommit(ctx, relPath, content) {
  const full = path.join(ctx.upstream, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(ctx.upstream, ['add', relPath]);
  git(ctx.upstream, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `add ${relPath}`]);
}

function runPeriodicPull(ctx) {
  execFileSync('bash', [PERIODIC_PULL, ctx.remoteCheckout], { encoding: 'utf8' });
}

function runNudge(ctx, changedFiles) {
  const env = { ...process.env, PATH: `${ctx.fakeBin}:${process.env.PATH}` };
  const result = spawnSync('bb', [NUDGE, ctx.remoteCheckout, TARGET_SWARM, ...changedFiles], { encoding: 'utf8', env });
  ctx.nudgeOutput = (result.stdout || '') + (result.stderr || '');
}

function readTmuxCallLog(ctx) {
  try {
    return fs.readFileSync(ctx.tmuxCallLog, 'utf8');
  } catch {
    return '';
  }
}

function registerSteps(registry) {
  registry.define(/^the second swarm runs under WSL2 with a registered self-hosted runner \(BL-091 merged\)$/, () => {
    const yaml = fs.readFileSync(WORKFLOW_YAML, 'utf8');
    if (!/runs-on:\s*\[self-hosted, second-swarm\]/.test(yaml)) {
      throw new Error('expected the workflow to run only on a self-hosted runner labeled for the second swarm');
    }
    if (/\bsecrets\./.test(yaml)) {
      throw new Error('expected the workflow YAML to contain no repo secrets (non-behavioral gate)');
    }
  });

  registry.define(/^the primary coordinator pushes a promotion assigning a ticket to the second swarm$/, (ctx) => {
    ensureUpstreamAndClone(ctx);
    pushCommit(ctx, 'backlog/active/BL-1-demo.yaml', 'id: BL-1\ntitle: "demo"\nswarm: second\n');
    ctx.changedFiles = ['backlog/active/BL-1-demo.yaml'];
  });

  registry.define(/^a push whose backlog changes concern only the primary swarm$/, (ctx) => {
    ensureUpstreamAndClone(ctx);
    pushCommit(ctx, 'backlog/active/BL-2-demo.yaml', 'id: BL-2\ntitle: "demo"\n');
    ctx.changedFiles = ['backlog/active/BL-2-demo.yaml'];
  });

  registry.define(/^the remote specifier already processed the latest assignment$/, (ctx) => {
    ensureUpstreamAndClone(ctx);
    pushCommit(ctx, 'backlog/active/BL-1-demo.yaml', 'id: BL-1\ntitle: "demo"\nswarm: second\n');
    ctx.changedFiles = ['backlog/active/BL-1-demo.yaml'];
    // The checkout was already synced (and nudged) when this assignment
    // first arrived - the duplicate-nudge scenario only wants to prove a
    // SECOND nudge for the same, already-delivered commit is harmless.
    runPeriodicPull(ctx);
    // Simulate the specifier having already fully processed this
    // assignment: an empty inbox/new, nothing left to dequeue.
    fs.mkdirSync(path.join(ctx.remoteCheckout, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  });

  registry.define(/^GitHub Actions is unavailable$/, (ctx) => {
    ensureUpstreamAndClone(ctx);
    ctx.bridgeUnavailable = true;
  });

  registry.define(/^new work is assigned to the second swarm$/, (ctx) => {
    pushCommit(ctx, 'backlog/active/BL-3-demo.yaml', 'id: BL-3\ntitle: "demo"\nswarm: second\n');
  });

  registry.define(/^the workflow run for that push completes$/, (ctx) => {
    runPeriodicPull(ctx);
    runNudge(ctx, ctx.changedFiles);
  });

  registry.define(/^the workflow evaluates the push$/, (ctx) => {
    runPeriodicPull(ctx);
    runNudge(ctx, ctx.changedFiles);
  });

  registry.define(/^a duplicate or repeated nudge arrives$/, (ctx) => {
    runNudge(ctx, ctx.changedFiles); // first nudge (already "processed")
    runNudge(ctx, ctx.changedFiles); // the duplicate
  });

  registry.define(/^the remote checkout contains the assignment commit$/, (ctx) => {
    const upstreamHead = git(ctx.upstream, ['rev-parse', 'HEAD']);
    const remoteHead = git(ctx.remoteCheckout, ['rev-parse', 'HEAD']);
    if (upstreamHead !== remoteHead) {
      throw new Error(`expected the remote checkout to be synced to ${upstreamHead}, got ${remoteHead}`);
    }
  });

  registry.define(/^the remote specifier pane received a wake-up nudge$/, (ctx) => {
    const log = readTmuxCallLog(ctx);
    if (!/swarmforge-second-specifier/.test(log)) {
      throw new Error(`expected a tmux call targeting the specifier's session, got log: ${log}`);
    }
  });

  registry.define(/^no wake-up is delivered to the remote specifier$/, (ctx) => {
    const log = readTmuxCallLog(ctx);
    if (log.trim().length > 0) {
      throw new Error(`expected no tmux wake-up call at all, got log: ${log}`);
    }
  });

  registry.define(/^ready_for_next\.sh reports no new work and nothing is disturbed$/, (ctx) => {
    if (!/^NUDGED:/m.test(ctx.nudgeOutput)) {
      throw new Error(`expected the duplicate nudge to still complete harmlessly, got: ${ctx.nudgeOutput}`);
    }
    const newDir = path.join(ctx.remoteCheckout, '.swarmforge', 'handoffs', 'inbox', 'new');
    const files = fs.existsSync(newDir) ? fs.readdirSync(newDir).filter((f) => f.endsWith('.handoff')) : [];
    if (files.length > 0) {
      throw new Error(`expected no new queued mail from the nudge itself (a tmux keystroke queues no handoff file), found: ${files.join(', ')}`);
    }
  });

  registry.define(/^the fallback periodic pull picks it up within its timer interval$/, (ctx) => {
    if (ctx.bridgeUnavailable !== true) {
      throw new Error('expected the bridge-unavailable precondition to have been set');
    }
    runPeriodicPull(ctx);
    const upstreamHead = git(ctx.upstream, ['rev-parse', 'HEAD']);
    const remoteHead = git(ctx.remoteCheckout, ['rev-parse', 'HEAD']);
    if (upstreamHead !== remoteHead) {
      throw new Error(`expected the periodic pull alone (no Actions bridge involved) to bring the remote checkout to ${upstreamHead}, got ${remoteHead}`);
    }
  });
}

module.exports = { registerSteps };
