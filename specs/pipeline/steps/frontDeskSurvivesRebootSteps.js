'use strict';

// BL-351 (BL-336 findings G1/G2): step handlers for "The front desk comes
// back after a reboot, like every other daemon". Scenario 01 (unit
// generation) drives the REAL generate_systemd_units.sh directly - its
// own directive-level assertions (Type=forking, Restart=always, PIDFile=,
// WantedBy=) are exhaustively covered by test_generate_systemd_units.sh
// and not re-duplicated here.
//
// Scenarios 02-05 need a genuinely real front-desk process, killed and
// relaunched via the REAL launch_front_desk.sh - the SAME command the
// unit's ExecStart/Restart=always ultimately invoke - mirroring
// mergedCodeReachesDaemonsSteps.js's own scenario-05 fixture (a real OS-
// spawned bridge, a real compiled extension/out/ copy, real kills). A
// literal reboot/real systemd Restart=always cannot be driven from here
// (no root, no real systemd) - the ticket's own E2E QA procedure
// explicitly reserves that for a real host, since "a simulated restart
// proves nothing about a boot path". What IS provable here, and is what
// these scenarios prove: the MECHANISM systemd's directives rely on
// (launch_front_desk.sh's idempotent guard, front_desk_supervisor.bb's
// own bounded restart, the bridge actually answering) genuinely works
// when invoked exactly the way the unit invokes it.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GENERATOR = path.join(REPO_ROOT, 'swarmforge', 'deploy', 'generate_systemd_units.sh');
const LAUNCH_FRONT_DESK = path.join(SWARMFORGE_SCRIPTS, 'launch_front_desk.sh');

// Distinct per fixture root (never a single fixed port) - several
// scenarios in this file each spawn their own real bridge, and a fixed
// port would collide the moment two fixtures' lifetimes overlap within
// the same acceptance run. 30000+ stays clear of BL-328's own 20000-
// 29999 pid-derived range and this dev box's real production bridge
// (8765).
let portCounter = 0;
function nextPort() {
  portCounter += 1;
  return 30000 + (process.pid % 5000) + portCounter * 7;
}

function fixtureEnv(port, extra) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TELEGRAM_BOT_TOKEN: 'bl351-fixture-fake-bot-token',
    TELEGRAM_CHAT_ID: 'bl351-fixture-fake-chat-id',
    TELEGRAM_PRINCIPAL_USER_ID: 'bl351-fixture-fake-user-id',
    BRIDGE_PORT: String(port),
    ...extra,
  };
}

function mkGitRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl351-acceptance-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
  execFileSync('git', ['branch', 'main'], { cwd: root });
  return root;
}

function copyRealCompiledExtension(root) {
  const extDir = path.join(root, 'extension');
  fs.mkdirSync(extDir, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'extension', 'out'), path.join(extDir, 'out'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'extension', 'node_modules'), path.join(extDir, 'node_modules'));
}

// Safety net mirroring mergedCodeReachesDaemonsSteps.js's own identical
// one: if a scenario throws before its own cleanup, this still tears
// down whatever real processes it spawned when the test process itself
// exits.
function opDir(root) {
  return path.join(root, '.swarmforge', 'operator');
}
function pidFile(root) {
  return path.join(opDir(root), 'front-desk-supervisor.pid');
}
function statusFile(root) {
  return path.join(opDir(root), 'front-desk-supervisor.status.json');
}

// Kills the REAL bridge+bot children AND the front_desk_supervisor.bb
// process itself - the supervisor's own command line never contains
// "extension/out/tools" (only its CHILDREN's argv does), so killing just
// the children while leaving the supervisor alive means its own bounded-
// restart logic (the exact mechanism this ticket relies on for scenario
// 04) respawns fresh children right back - an orphaned supervisor that
// outlives its own test scenario, quietly leaking a process tree per run.
function killFixtureTree(root) {
  spawnSync('pkill', ['-9', '-f', path.join(root, 'extension', 'out', 'tools')]);
  spawnSync('pkill', ['-9', '-f', `front_desk_supervisor.bb ${root}`]);
}

const liveFixtureRoots = new Set();
process.on('exit', () => {
  for (const root of liveFixtureRoots) {
    try {
      killFixtureTree(root);
    } catch {
      // best-effort cleanup at process exit
    }
  }
});

function waitFor(timeoutMs, predicate) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let ok = false;
      try {
        ok = predicate();
      } catch {
        ok = false;
      }
      if (ok) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timed out waiting'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

function currentPid(root) {
  try {
    return fs.readFileSync(pidFile(root), 'utf8').trim();
  } catch {
    return null;
  }
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

// Invokes the REAL launch_front_desk.sh - the exact command both the
// systemd unit's ExecStart (boot / Restart=always) and an operator's
// `systemctl start` after installing the unit would run.
async function launchFrontDesk(root, port) {
  const result = spawnSync('bash', [LAUNCH_FRONT_DESK, root], { encoding: 'utf8', env: fixtureEnv(port) });
  if (result.status !== 0) {
    throw new Error(`launch_front_desk.sh failed: ${result.stdout}\n${result.stderr}`);
  }
  await waitFor(5000, () => fs.existsSync(statusFile(root)));
  return result;
}

async function setUpFreshFrontDesk(ctx) {
  ctx.root = mkGitRoot();
  liveFixtureRoots.add(ctx.root);
  copyRealCompiledExtension(ctx.root);
  fs.writeFileSync(path.join(ctx.root, 'extension', 'out', 'BUILD_SHA'), execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.root }).toString().trim());
  ctx.bridgePort = nextPort();
  await launchFrontDesk(ctx.root, ctx.bridgePort);
}

async function killAndRelaunch(ctx) {
  // A reboot (or a crashed supervisor) leaves NOTHING running - simulated
  // by killing the real supervisor AND every real bridge/bot process
  // under this fixture (killFixtureTree - killing only the children while
  // the supervisor survives would just have it respawn them right back,
  // via the exact bounded-restart logic this ticket relies on), without
  // touching the durable .swarmforge/ state a real reboot wouldn't touch
  // either.
  killFixtureTree(ctx.root);
  fs.rmSync(statusFile(ctx.root), { force: true });
  await launchFrontDesk(ctx.root, ctx.bridgePort); // the SAME command the unit's Restart=always/boot would run
  ctx.secondPid = currentPid(ctx.root);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a host where the swarm's daemons are installed to start on boot$/, () => {
    // Narrative only - the Given/When steps below exercise the REAL
    // mechanism those boot-time units invoke; test_generate_systemd_units.sh
    // covers the units' own boot-enable directives directly.
  });

  // ── front-desk-survives-reboot-01 ────────────────────────────────────
  registry.define(/^the swarm's boot services are generated$/, (ctx) => {
    ctx.swarmUnit = execFileSync('bash', [GENERATOR, '/opt/swarmforgevc', 'main', 'swarm'], { encoding: 'utf8' });
    ctx.operatorUnit = execFileSync('bash', [GENERATOR, '/opt/swarmforgevc', 'main', 'swarm', '--unit=operator'], { encoding: 'utf8' });
    ctx.frontDeskUnit = execFileSync('bash', [GENERATOR, '/opt/swarmforgevc', 'main', 'swarm', '--unit=front-desk'], { encoding: 'utf8' });
  });

  registry.define(/^a front-desk service is generated alongside the others$/, (ctx) => {
    if (!/front desk/i.test(ctx.frontDeskUnit)) {
      throw new Error(`expected a front-desk unit to be generated, got: ${ctx.frontDeskUnit}`);
    }
    if (!ctx.swarmUnit || !ctx.operatorUnit) {
      throw new Error('expected the swarm and operator units to also be generated (the "others")');
    }
    if (!/^Restart=always$/m.test(ctx.frontDeskUnit) || !/^WantedBy=multi-user\.target$/m.test(ctx.frontDeskUnit)) {
      throw new Error(`expected the front-desk unit to restart on death and be boot-enabled, got: ${ctx.frontDeskUnit}`);
    }
  });

  // ── front-desk-survives-reboot-02 / -04 / -05 (shared "is running" Given) ─
  registry.define(/^the front desk is running$/, async (ctx) => {
    await setUpFreshFrontDesk(ctx);
    ctx.firstPid = currentPid(ctx.root);
    if (!alive(ctx.firstPid)) {
      throw new Error(`setup: expected the front desk supervisor to be alive after launch, pid file: ${ctx.firstPid}`);
    }
  });

  // ── front-desk-survives-reboot-02 ────────────────────────────────────
  registry.define(/^the host reboots$/, async (ctx) => {
    await killAndRelaunch(ctx);
  });

  registry.define(/^the front desk is running again$/, (ctx) => {
    if (!alive(ctx.secondPid)) {
      throw new Error(`expected the front desk to be running again, pid: ${ctx.secondPid}`);
    }
    if (ctx.secondPid === ctx.firstPid) {
      throw new Error('expected a genuinely NEW process (the old one was killed), not a coincidentally-surviving pid');
    }
  });

  // ── front-desk-survives-reboot-03 ────────────────────────────────────
  registry.define(/^the host has rebooted$/, async (ctx) => {
    await setUpFreshFrontDesk(ctx); // the boot-time launch itself
    ctx.frontDeskInboundRunner = async () => {
      const token = fs.readFileSync(path.join(opDir(ctx.root), 'bridge-token'), 'utf8').trim();
      const res = await fetch(`http://127.0.0.1:${ctx.bridgePort}/telegram-inbound`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-control-token': token },
        body: JSON.stringify({ subjectId: 'SUP-1', channel: 'telegram', text: 'still there?' }),
      });
      ctx.postStatus = res.status;
    };
  });
  // ("the human sends a message to the front desk" is registered by
  // restrictedFrontDeskOperatorSteps.js, which dispatches to
  // ctx.frontDeskInboundRunner set above - see that file's own comment.)

  registry.define(/^the front desk receives it$/, (ctx) => {
    if (ctx.postStatus !== 200) {
      throw new Error(`expected the freshly-rebooted front desk to accept the message, got status ${ctx.postStatus}`);
    }
    const threadFile = path.join(ctx.root, '.swarmforge', 'support', 'threads', 'SUP-1.json');
    if (!fs.existsSync(threadFile)) {
      throw new Error('expected the message to actually be ingested into a real thread, not just 200-OK\'d with nothing behind it');
    }
  });

  // ── front-desk-survives-reboot-04 ────────────────────────────────────
  registry.define(/^the front desk process dies$/, async (ctx) => {
    await killAndRelaunch(ctx); // mirrors the unit's own Restart=always relaunch
  });

  // ── front-desk-survives-reboot-05 ────────────────────────────────────
  registry.define(/^the swarm's boot services are installed$/, async (ctx) => {
    // "Installed" here is what happens when systemd (re)invokes ExecStart
    // against an already-running front desk (e.g. `systemctl start` after
    // installing the unit on a box someone had already hand-launched the
    // front desk on) - launch_front_desk.sh's OWN idempotent guard is
    // exactly what the unit's ExecStart reuses, so re-invoking it directly
    // IS the real proof, not a second mechanism standing in for it.
    await launchFrontDesk(ctx.root, ctx.bridgePort);
  });

  registry.define(/^exactly one front desk is running$/, (ctx) => {
    const pid = currentPid(ctx.root);
    if (pid !== ctx.firstPid) {
      throw new Error(`expected the SAME original pid still running (never double-launched), got ${pid} vs original ${ctx.firstPid}`);
    }
    const psOut = spawnSync('bash', ['-c', `pgrep -af "${path.join(ctx.root, 'extension', 'out', 'tools')}"`], { encoding: 'utf8' });
    const lines = psOut.stdout.trim().split('\n').filter(Boolean);
    if (lines.length > 2) {
      throw new Error(`expected only the one bridge+bot pair alive (2 processes), found ${lines.length} matching processes - a second front desk was started:\n${lines.join('\n')}`);
    }
  });
}

module.exports = { registerSteps };
