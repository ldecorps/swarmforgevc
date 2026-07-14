'use strict';

// BL-368: step handlers for "Losing the control channel is never mistaken
// for every agent dying". Drives the REAL swarmforge/scripts/operator_
// runtime.bb (a genuine bb subprocess, --tick-once) and the REAL
// swarmforge/scripts/role_lifecycle.sh unpark path (a genuine bash
// subprocess against a REAL isolated tmux socket) - never a hand-rolled
// substitute for either the detection layer or the relaunch-guard layer
// this ticket adds.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync, spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const OPERATOR_RUNTIME_BB_FILES = [
  'operator_lib.bb',
  'operator_runtime.bb',
  'telegram_topic_lib.bb',
  'support_lib.bb',
  'support_thread_store.bb',
  'operator_memory_lib.bb',
  'operator_memory_store.bb',
  'ticket_status_lib.bb',
  'operator_ask.bb',
  'handoff_lib.bb',
  'daemon_alarm_lib.bb',
];

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkRuntimeFixture() {
  const target = mkTmp('sfvc-bl368-runtime-');
  const scriptsDir = path.join(target, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(path.join(target, '.swarmforge', 'operator'), { recursive: true });
  for (const f of OPERATOR_RUNTIME_BB_FILES) {
    fs.copyFileSync(path.join(SWARM_SCRIPTS, f), path.join(scriptsDir, f));
  }
  return target;
}

function writeRolesTsv(target, roles) {
  const lines = roles.map((r) => `${r}\t${r}\t${target}/.worktrees/${r}\tswarmforge-${r}\t${r}\tclaude\ttask\toff\n`).join('');
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(target, '.swarmforge', 'roles.tsv'), lines);
}

function tick(target) {
  return execFileSync('bb', [path.join(target, 'swarmforge', 'scripts', 'operator_runtime.bb'), target, '--tick-once'], {
    env: { ...process.env, OPERATOR_SKIP_LAUNCH: '1' },
    encoding: 'utf8',
  });
}

function eventsText(target) {
  const opDir = path.join(target, '.swarmforge', 'operator');
  let text = '';
  for (const name of ['events.jsonl', 'events.inflight.jsonl']) {
    const p = path.join(opDir, name);
    if (fs.existsSync(p)) {
      text += fs.readFileSync(p, 'utf8');
    }
  }
  return text;
}

function mkRoleLifecycleFixture(role) {
  const root = mkTmp('sfvc-bl368-relaunch-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'heartbeat'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), `window ${role} claude ${role} --model x\n`);
  return root;
}

function mkFakeClaudeBin() {
  const dir = mkTmp('sfvc-bl368-fakebin-');
  const claude = path.join(dir, 'claude');
  fs.writeFileSync(claude, '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(claude, 0o755);
  return dir;
}

function roleLifecycleEnv(fakeBin) {
  const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };
  delete env.SWARMFORGE_CONFIG;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

function tmuxSocketFor(target) {
  const out = execFileSync(
    'zsh',
    ['-c', `source '${path.join(SWARM_SCRIPTS, 'swarmforge.sh')}' '${target}' >/dev/null 2>&1; echo $TMUX_SOCKET`],
    { encoding: 'utf8' }
  );
  return out.trim();
}

function sessionAlive(target, session) {
  const sock = tmuxSocketFor(target);
  if (!sock) return false;
  const result = spawnSync('tmux', ['-S', sock, 'has-session', '-t', session]);
  return result.status === 0;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the swarm is running with all its roles alive$/, (ctx) => {
    ctx.roles = ['coder', 'QA'];
  });

  // ── control-loss-is-not-agent-death-01 ──────────────────────────────
  registry.define(/^the swarm's control channel becomes unreachable while every agent is still alive$/, (ctx) => {
    ctx.runtimeTarget = mkRuntimeFixture();
    writeRolesTsv(ctx.runtimeTarget, ctx.roles);
    // The incident shape: a pointer file that still names a path, but the
    // underlying unix socket does not exist - never "no pointer at all"
    // (which is the ordinary pre-launch state, not a loss of anything).
    fs.writeFileSync(path.join(ctx.runtimeTarget, '.swarmforge', 'tmux-socket'), path.join(ctx.runtimeTarget, '.swarmforge', 'tmux', 'nonexistent.sock'));
    tick(ctx.runtimeTarget);
    ctx.events = eventsText(ctx.runtimeTarget);
  });

  registry.define(/^the swarm reports that it has lost control of the swarm$/, (ctx) => {
    if (!ctx.events.includes('SWARM_CONTROL_LOST')) {
      throw new Error(`expected a SWARM_CONTROL_LOST event, got: ${ctx.events}`);
    }
  });

  registry.define(/^it does not report any agent as having exited$/, (ctx) => {
    if (ctx.events.includes('AGENT_EXITED')) {
      throw new Error(`expected NO AGENT_EXITED events alongside a control-lost signal, got: ${ctx.events}`);
    }
  });

  // ── control-loss-is-not-agent-death-02 ──────────────────────────────
  registry.define(/^the swarm believes a role has exited$/, (ctx) => {
    // The premise this scenario tests the GUARD against - the role's
    // process is ACTUALLY alive (a real, live process), regardless of
    // whatever led the caller to believe otherwise. A wrong belief must
    // never be actable.
    ctx.role = 'coder';
    ctx.roleLifecycleTarget = mkRoleLifecycleFixture(ctx.role);
    ctx.liveProcess = spawn('sleep', ['20'], { stdio: 'ignore' });
    const heartbeat = `role: ${ctx.role}\npid: ${ctx.liveProcess.pid}\nlast_beat: "2026-07-14T00:00:00Z"\nlast_tool: Bash\nphase: entry\nin_flight: false\nbeat_count: 1\n`;
    fs.writeFileSync(path.join(ctx.roleLifecycleTarget, '.swarmforge', 'heartbeat', `${ctx.role}.yaml`), heartbeat);
  });

  registry.define(/^it tries to start that role again$/, (ctx) => {
    const fakeBin = mkFakeClaudeBin();
    const roleLifecycleSh = path.join(SWARM_SCRIPTS, 'role_lifecycle.sh');
    ctx.relaunchResult = spawnSync('bash', [roleLifecycleSh, ctx.roleLifecycleTarget, 'unpark', ctx.role], {
      env: roleLifecycleEnv(fakeBin),
      encoding: 'utf8',
    });
  });

  registry.define(/^it refuses, because that role's process is still running$/, (ctx) => {
    if (ctx.relaunchResult.status === 0) {
      throw new Error('expected unpark to REFUSE (nonzero exit) when the role\'s process is still alive');
    }
    if (!(ctx.relaunchResult.stderr || '').includes('still alive')) {
      throw new Error(`expected the refusal to name the reason, got stderr: ${ctx.relaunchResult.stderr}`);
    }
  });

  registry.define(/^no second agent is started on that role's worktree$/, (ctx) => {
    try {
      if (sessionAlive(ctx.roleLifecycleTarget, `swarmforge-${ctx.role}`)) {
        throw new Error('expected NO tmux session created for the refused role');
      }
    } finally {
      if (ctx.liveProcess) {
        ctx.liveProcess.kill();
      }
    }
  });

  // ── control-loss-is-not-agent-death-03: the real detection must survive ──
  registry.define(/^a role's agent process has really died$/, (ctx) => {
    ctx.roles = ['coder', 'QA'];
    ctx.runtimeTarget = mkRuntimeFixture();
    writeRolesTsv(ctx.runtimeTarget, ctx.roles);
    ctx.sockDir = mkTmp('sfvc-bl368-real-sock-');
    ctx.sock = path.join(ctx.sockDir, 'bl368.sock');
    execFileSync('tmux', ['-S', ctx.sock, 'new-session', '-d', '-s', 'swarmforge-coder', '-n', 'agent']);
    execFileSync('tmux', ['-S', ctx.sock, 'new-session', '-d', '-s', 'swarmforge-QA', '-n', 'agent']);
    fs.writeFileSync(path.join(ctx.runtimeTarget, '.swarmforge', 'tmux-socket'), ctx.sock);
    execFileSync('tmux', ['-S', ctx.sock, 'kill-session', '-t', 'swarmforge-QA']);
  });

  registry.define(/^the swarm checks the health of its roles$/, (ctx) => {
    ctx.tickOutput = tick(ctx.runtimeTarget);
    ctx.events = eventsText(ctx.runtimeTarget);
  });

  registry.define(/^it reports that role as exited$/, (ctx) => {
    if (!ctx.events.includes('"AGENT_EXITED","subject":"QA"')) {
      throw new Error(`expected QA reported as AGENT_EXITED, got: ${ctx.events}`);
    }
    if (ctx.events.includes('SWARM_CONTROL_LOST')) {
      throw new Error('expected no SWARM_CONTROL_LOST - the socket is genuinely reachable here');
    }
  });

  registry.define(/^it recovers it$/, (ctx) => {
    // "Recovers" at the scripted layer means dispatched into the launch
    // pipeline for the disposable Operator to act on - actually respawning
    // the pane is LLM-mediated by design (this architecture's own "the
    // runtime detects, the disposable Operator decides" split). The
    // dispatch itself is what OPERATOR_SKIP_LAUNCH=1 still proves: the
    // event reached the inflight batch, exactly the same proof this
    // repo's own pre-existing AGENT_EXITED tests already rely on.
    if (!ctx.tickOutput.includes('"launched?":true')) {
      throw new Error(`expected the tick to have dispatched the exited role into the launch pipeline, got: ${ctx.tickOutput}`);
    }
    // Cleanup only - the server may have already exited on its own once
    // its last live pane's process ended; that is not this step's concern.
    spawnSync('tmux', ['-S', ctx.sock, 'kill-server']);
  });

  // ── control-loss-is-not-agent-death-04 ──────────────────────────────
  registry.define(/^the swarm loses control of its agents$/, (ctx) => {
    ctx.roles = ['coder'];
    ctx.runtimeTarget = mkRuntimeFixture();
    writeRolesTsv(ctx.runtimeTarget, ctx.roles);
    fs.writeFileSync(path.join(ctx.runtimeTarget, '.swarmforge', 'tmux-socket'), path.join(ctx.runtimeTarget, '.swarmforge', 'tmux', 'nonexistent.sock'));
    tick(ctx.runtimeTarget);
  });

  registry.define(/^a human is told the swarm needs attention$/, (ctx) => {
    // Logged UNCONDITIONALLY to the durable audit trail (runtime.log) -
    // never load-bearing on an LLM Operator happening to launch and notice
    // (the ticket's own explicit worry: "That correctness came from an
    // LLM's judgment... It must not be load-bearing").
    const logPath = path.join(ctx.runtimeTarget, '.swarmforge', 'operator', 'runtime.log');
    if (!fs.existsSync(logPath) || !fs.readFileSync(logPath, 'utf8').includes('SWARM_CONTROL_LOST')) {
      throw new Error('expected the control-loss to be logged loudly and unconditionally to runtime.log');
    }
  });
}

module.exports = { registerSteps };
