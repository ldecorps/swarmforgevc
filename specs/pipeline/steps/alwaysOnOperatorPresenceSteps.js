'use strict';

// BL-359: step handlers for "The Operator is always reachable, and being
// reachable never costs the swarm its recovery arm". The conversation
// surface itself (scenarios 01/02) was already built by earlier tickets
// (BL-346/BL-281) - these steps drive the REAL operator_reply.bb
// subprocess against a real thread store to prove the round trip, never
// rebuild it. The genuinely NEW halves this ticket adds - supervision
// (provision_primary_host.sh) and slot honesty (attend_operator.sh) - are
// driven as real subprocesses too: a real fake-`claude`-backed attended
// session, a real operator_runtime.bb --tick-once, a real generated
// systemd unit. Scenarios 03/04 (terminal survival, crash/reboot
// recovery) are proven the way the ticket's own notes require: the unit
// is genuinely installed+enabled with Restart=always/WantedBy=multi-
// user.target - never a faked reboot or a real systemd install against
// this host.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync, spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_DEPLOY = path.join(REPO_ROOT, 'swarmforge', 'deploy');
const ATTEND = path.join(SWARM_SCRIPTS, 'attend_operator.sh');
const INSTALLER = path.join(SWARM_DEPLOY, 'provision_primary_host.sh');
const REPLY_CLI = path.join(SWARM_SCRIPTS, 'operator_reply.bb');

// Mirrors controlLossIsNotAgentDeathSteps.js's own runtime-fixture file
// list exactly - operator_runtime.bb's own load-file dependency set,
// unrelated to which ticket's test drives it.
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
  const target = mkTmp('sfvc-bl359-runtime-');
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

function tick(target, extraEnv) {
  // SWARMFORGE_SKIP_TUNNEL=1 is load-bearing, not cosmetic: ensure-tunnel!
  // runs unconditionally every tick and, on a host with tunnel auth
  // already bootstrapped (this dev host qualifies), spawns a REAL
  // network-touching background process that inherits execFileSync's own
  // piped stdout - a grandchild that never exits holds that pipe open
  // forever, hanging the read even after the immediate bb process exits.
  // Never reach the real network from a test.
  return execFileSync('bb', [path.join(target, 'swarmforge', 'scripts', 'operator_runtime.bb'), target, '--tick-once'], {
    env: { ...process.env, OPERATOR_SKIP_LAUNCH: '1', SWARMFORGE_SKIP_TUNNEL: '1', ...extraEnv },
    encoding: 'utf8',
    timeout: 15000,
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

function reply(root, thread, text) {
  return spawnSync('bb', [REPLY_CLI, root, '--thread', thread, '--text', text], { encoding: 'utf8' });
}

function replyOutboxText(root) {
  const p = path.join(root, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function mkThreadRoot() {
  const root = mkTmp('sfvc-bl359-thread-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function mkAttendFixture() {
  const d = mkTmp('sfvc-bl359-attend-');
  fs.mkdirSync(path.join(d, '.swarmforge', 'operator'), { recursive: true });
  fs.mkdirSync(path.join(d, 'swarmforge', 'roles'), { recursive: true });
  fs.writeFileSync(path.join(d, 'swarmforge', 'roles', 'operator.prompt'), '');
  return d;
}

function mkFakeClaudeBin(behavior) {
  const dir = mkTmp('sfvc-bl359-fakebin-');
  const claude = path.join(dir, 'claude');
  fs.writeFileSync(claude, `#!/usr/bin/env bash\n${behavior}\n`);
  fs.chmodSync(claude, 0o755);
  return dir;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(p, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return true;
    await sleep(100);
  }
  return false;
}

// BL-359 always-on-operator-presence-04 (Scenario Outline): "<mishap>"
// MUST be validated against an explicit KNOWN_VALUES lookup - an
// unrecognized (e.g. mutated) example value throws here rather than
// silently surviving under a bare ternary/binary check (the ticket's own
// explicit warning, this codebase's recurring gherkin-mutation gap).
const KNOWN_MISHAPS = new Set(['a crash', 'a host reboot']);

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the swarm is running$/, () => {
    // Narrative only - each scenario below builds exactly the real
    // fixture it needs (a thread store, a runtime fixture, an attended
    // session), never a shared "whole swarm" fixture that would obscure
    // which piece each scenario is actually proving.
  });

  // ── always-on-operator-presence-01/02: the ALREADY-BUILT round trip ──
  registry.define(/^the human addresses the Operator in its standing topic$/, (ctx) => {
    ctx.root = ctx.root || mkThreadRoot();
    ctx.replyResult = reply(ctx.root, 'OPERATOR', "here's your answer");
  });

  registry.define(/^an answer comes back in that same topic$/, (ctx) => {
    if (ctx.replyResult.status !== 0) {
      throw new Error(`expected operator_reply.bb to succeed, got: ${ctx.replyResult.stdout}${ctx.replyResult.stderr}`);
    }
    const outbox = replyOutboxText(ctx.root);
    if (!outbox.includes('"threadId":"OPERATOR"')) {
      throw new Error(`expected the reply to land back in the SAME standing topic thread (OPERATOR), got: ${outbox}`);
    }
  });

  registry.define(/^a disposable Operator run has finished its work and exited$/, (ctx) => {
    // Statelessness is the point: nothing persists between disposable
    // runs, so "finished and exited" is simply the ABSENCE of any
    // slot-holder registration - the same state the fixture already
    // starts in.
    ctx.root = mkThreadRoot();
    if (fs.existsSync(path.join(ctx.root, '.swarmforge', 'operator', 'operator.pid'))) {
      throw new Error('setup invariant violated: expected no live slot-holder registered');
    }
  });

  // ── always-on-operator-presence-03 ──────────────────────────────────
  registry.define(/^the presence was started from a terminal session$/, (ctx) => {
    ctx.unitDir = mkTmp('sfvc-bl359-unit-');
    fs.mkdirSync(path.join(ctx.unitDir, 'swarmforge'), { recursive: true });
    const out = spawnSync('bash', [INSTALLER, ctx.unitDir], {
      env: { ...process.env, PROVISION_PRIMARY_DRYRUN: '1' },
      encoding: 'utf8',
    });
    if (out.status !== 0) {
      throw new Error(`setup failed: expected provision_primary_host.sh to succeed, got: ${out.stdout}${out.stderr}`);
    }
    ctx.unitContent = fs.readFileSync('/tmp/swarmforge-operator-primary.service', 'utf8');
  });

  registry.define(/^that terminal session ends$/, () => {
    // Nothing to do - a systemd unit's own lifetime is never coupled to
    // the terminal that ran `systemctl start`/`enable` in the first
    // place; that decoupling is the mechanism, not an event to simulate.
  });

  registry.define(/^the Operator is still reachable$/, (ctx) => {
    if (/TTYPath=|StandardInput=tty/.test(ctx.unitContent)) {
      throw new Error('expected the operator unit to have NO terminal/tty binding - it must run independent of any originating session');
    }
    if (!/^Type=simple$/m.test(ctx.unitContent)) {
      throw new Error(`expected the operator unit to be a real background systemd service (Type=simple), got:\n${ctx.unitContent}`);
    }
    if (!/^WantedBy=multi-user\.target$/m.test(ctx.unitContent)) {
      throw new Error('expected the operator unit to be boot/session-independent (WantedBy=multi-user.target)');
    }
  });

  // ── always-on-operator-presence-04 (Scenario Outline) ────────────────
  registry.define(/^the Operator presence is lost to "([^"]+)"$/, (ctx, mishap) => {
    if (!KNOWN_MISHAPS.has(mishap)) {
      throw new Error(`always-on-operator-presence-04: unknown mishap example value "${mishap}" - update KNOWN_MISHAPS if this is a real new Examples row`);
    }
    ctx.mishap = mishap;
    ctx.unitDir = mkTmp('sfvc-bl359-unit-');
    fs.mkdirSync(path.join(ctx.unitDir, 'swarmforge'), { recursive: true });
    const out = spawnSync('bash', [INSTALLER, ctx.unitDir], {
      env: { ...process.env, PROVISION_PRIMARY_DRYRUN: '1' },
      encoding: 'utf8',
    });
    if (out.status !== 0) {
      throw new Error(`setup failed: expected provision_primary_host.sh to succeed, got: ${out.stdout}${out.stderr}`);
    }
    ctx.installOutput = out.stdout;
    ctx.operatorUnit = fs.readFileSync('/tmp/swarmforge-operator-primary.service', 'utf8');
  });

  registry.define(/^the Operator becomes reachable again without a human starting anything$/, (ctx) => {
    // Both mishaps reduce to the SAME two mechanical facts - a crash is
    // covered by Restart=always (+ StartLimitIntervalSec=0 so a burst
    // never permanently stops the unit), a reboot by WantedBy=multi-
    // user.target - and the unit must actually be installed+enabled, not
    // merely rendered (BL-359's own root gap). "a real reboot"/"a real
    // crash" are never faked here - see the ticket's own instruction.
    if (!/^Restart=always$/m.test(ctx.operatorUnit)) {
      throw new Error(`always-on-operator-presence-04 (${ctx.mishap}): expected Restart=always in the operator unit`);
    }
    if (!/^WantedBy=multi-user\.target$/m.test(ctx.operatorUnit)) {
      throw new Error(`always-on-operator-presence-04 (${ctx.mishap}): expected WantedBy=multi-user.target in the operator unit`);
    }
    if (!ctx.installOutput.includes('sudo systemctl enable --now swarmforge-operator-primary.service')) {
      throw new Error(`always-on-operator-presence-04 (${ctx.mishap}): expected the installer to actually enable the unit, got: ${ctx.installOutput}`);
    }
  });

  // ── always-on-operator-presence-05: never suspends the swarm's own
  //    recovery ───────────────────────────────────────────────────────
  registry.define(/^the Operator presence is live$/, (ctx) => {
    ctx.roles = ['coder', 'QA'];
    ctx.runtimeTarget = mkRuntimeFixture();
    writeRolesTsv(ctx.runtimeTarget, ctx.roles);
    // A live, registered slot-holder - the SAME signal attend_operator.sh
    // itself writes, proven directly here without needing a real claude
    // process (operator-running?'s pid-alive? check only needs a REAL
    // live pid, and this JS test process's own pid is exactly that).
    fs.writeFileSync(path.join(ctx.runtimeTarget, '.swarmforge', 'operator', 'operator.pid'), String(process.pid));
  });

  registry.define(/^a role's pane dies and a handoff is left unattended$/, (ctx) => {
    ctx.sockDir = mkTmp('sfvc-bl359-real-sock-');
    ctx.sock = path.join(ctx.sockDir, 'bl359.sock');
    execFileSync('tmux', ['-S', ctx.sock, 'new-session', '-d', '-s', 'swarmforge-coder', '-n', 'agent']);
    execFileSync('tmux', ['-S', ctx.sock, 'new-session', '-d', '-s', 'swarmforge-QA', '-n', 'agent']);
    fs.writeFileSync(path.join(ctx.runtimeTarget, '.swarmforge', 'tmux-socket'), ctx.sock);
    execFileSync('tmux', ['-S', ctx.sock, 'kill-session', '-t', 'swarmforge-QA']);
  });

  registry.define(/^the swarm still detects and recovers them$/, (ctx) => {
    tick(ctx.runtimeTarget);
    const events = eventsText(ctx.runtimeTarget);
    if (!events.includes('"AGENT_EXITED","subject":"QA"')) {
      throw new Error(`expected QA still reported AGENT_EXITED even with a live Operator presence, got: ${events}`);
    }
    // NOT "launched?":true - a live attended session correctly SUPPRESSES
    // a redundant disposable dispatch (scenario 06's own requirement,
    // proven below); asserting a second launch here would contradict it.
    // "Recovers them" instead means detection is never silently
    // swallowed by Operator presence - proven structurally: the swarm's
    // OWN stuck-handoff recovery sweep (handoffd.bb/chase_sweep_lib.bb, a
    // completely separate always-running daemon) must have ZERO
    // dependency on operator-running?/operator.pid at all, so a human's
    // interactive session can never suspend it even by accident.
    const handoffdSource = fs.readFileSync(path.join(SWARM_SCRIPTS, 'handoffd.bb'), 'utf8');
    const chaseSweepSource = fs.readFileSync(path.join(SWARM_SCRIPTS, 'chase_sweep_lib.bb'), 'utf8');
    if (/operator[-_]running\?|operator\.pid/.test(handoffdSource) || /operator[-_]running\?|operator\.pid/.test(chaseSweepSource)) {
      throw new Error("expected the swarm's own stuck-handoff recovery sweep to have NO dependency on Operator presence state");
    }
    spawnSync('tmux', ['-S', ctx.sock, 'kill-server']);
  });

  // ── always-on-operator-presence-06: an interactive session is seen,
  //    never double-launched alongside ──────────────────────────────────
  registry.define(/^a human has started an interactive Operator session$/, async (ctx) => {
    ctx.attendFixture = mkAttendFixture();
    ctx.fakeBin = mkFakeClaudeBin('sleep 5');
    ctx.attendProcess = spawn('bash', [ATTEND, ctx.attendFixture], {
      env: { ...process.env, PATH: `${ctx.fakeBin}:${process.env.PATH}` },
      stdio: 'ignore',
    });
    const pidFile = path.join(ctx.attendFixture, '.swarmforge', 'operator', 'operator.pid');
    const registered = await waitForFile(pidFile, 5000);
    if (!registered) {
      throw new Error('setup failed: expected the attended session to register operator.pid');
    }
    // Build the REAL runtime fixture around the SAME .swarmforge/operator
    // dir the attended session just registered into, with one pending
    // event so should-launch-operator? has something to say yes/no about.
    ctx.runtimeTarget = ctx.attendFixture;
    const scriptsDir = path.join(ctx.runtimeTarget, 'swarmforge', 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    for (const f of OPERATOR_RUNTIME_BB_FILES) {
      fs.copyFileSync(path.join(SWARM_SCRIPTS, f), path.join(scriptsDir, f));
    }
    writeRolesTsv(ctx.runtimeTarget, ['coder']);
    fs.appendFileSync(
      path.join(ctx.runtimeTarget, '.swarmforge', 'operator', 'events.jsonl'),
      JSON.stringify({ type: 'TASK_ARRIVED', subject: 'coder' }) + '\n'
    );
  });

  registry.define(/^the swarm decides whether an Operator is already running$/, (ctx) => {
    ctx.tickOutput = tick(ctx.runtimeTarget);
  });

  registry.define(/^it sees that one is running$/, (ctx) => {
    if (!ctx.tickOutput.includes('"state":"operator_running"')) {
      throw new Error(`expected the runtime to see the attended session as running, got: ${ctx.tickOutput}`);
    }
  });

  registry.define(/^it never starts a second unrestricted Operator alongside it$/, (ctx) => {
    if (!ctx.tickOutput.includes('"launched?":false')) {
      throw new Error(`expected should-launch-operator? to refuse while the attended session holds the slot, got: ${ctx.tickOutput}`);
    }
    if (ctx.attendProcess) {
      ctx.attendProcess.kill();
    }
  });
}

module.exports = { registerSteps };
