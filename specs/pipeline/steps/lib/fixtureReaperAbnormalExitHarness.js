'use strict';

// BL-458 fixture-process-leak-02: a standalone harness (not a step file - a
// separate Node process the acceptance step spawns and SIGTERMs) that
// stands in for "a step file has launched a detached front-desk supervisor,
// bridge, bot, and tmux server rooted in a fixture directory" and is then
// interrupted BEFORE its own inline teardown would ever run. Deliberately
// never calls reap()/stopFrontDesk itself - the whole point is to prove
// track()'s own signal handler is what cleans up when nothing else does.
//
// Usage: node fixtureReaperAbnormalExitHarness.js <root> <port>
// Prints "READY <json>" to stdout once the fixture is fully up, then sleeps
// forever until the parent sends SIGTERM.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { track } = require('./fixtureReaper');

const [, , root, port] = process.argv;
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LAUNCHER = path.join(SCRIPTS_DIR, 'launch_front_desk.sh');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const FAKE_TELEGRAM_ENV = { TELEGRAM_BOT_TOKEN: 'fake-bot-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_PRINCIPAL_USER_ID: '111' };

function linkCompiledOut() {
  fs.mkdirSync(path.join(root, 'extension', 'out'), { recursive: true });
  for (const dir of ['tools', 'bridge', 'notify', 'swarm', 'panel', 'metrics', 'docs', 'i18n']) {
    fs.symlinkSync(path.join(EXT_OUT, dir), path.join(root, 'extension', 'out', dir));
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function main() {
  linkCompiledOut();

  // track() is registered BEFORE anything is launched - exactly the
  // ordering a real step file's Given must follow, so even a crash mid-
  // launch is still covered.
  track(root);

  execFileSync('bash', ['-c', `${LAUNCHER} "$1" 2>&1`, '--', root], {
    encoding: 'utf8',
    env: { ...process.env, ...FAKE_TELEGRAM_ENV, BRIDGE_PORT: port, FRONT_DESK_INTERVAL_MS: '200' },
  });

  const tokenFile = path.join(root, '.swarmforge', 'operator', 'bridge-token');
  const token = await waitFor(() => fs.existsSync(tokenFile), 5000).then(() => fs.readFileSync(tokenFile, 'utf8'));
  const up = await waitFor(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/pipeline`, { headers: { authorization: `Bearer ${token}` } });
      return res.status === 200;
    } catch {
      return false;
    }
  }, 5000);
  if (!up) {
    throw new Error('fixture bridge never came up');
  }

  // A real, separate tmux server rooted in the SAME fixture (role_lifecycle
  // .sh's own mechanism - a swarm role's detached tmux session), so this
  // scenario's "no tmux server for that fixture's socket survives" claim is
  // exercised against a real server, not just the front-desk trio.
  const tmuxSocket = path.join(root, 'role.sock');
  execFileSync('tmux', ['-S', tmuxSocket, 'new-session', '-d', '-s', 'reaper-abnormal-exit-test']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), tmuxSocket);

  const status = JSON.parse(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'front-desk-supervisor.status.json'), 'utf8'));
  const supervisorPid = Number(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'front-desk-supervisor.pid'), 'utf8').trim());
  process.stdout.write(`READY ${JSON.stringify({ bridgePid: status.bridge.pid, botPid: status.bot.pid, supervisorPid, tmuxSocket })}\n`);

  // Deliberately never reaps itself - waits to be killed, simulating a
  // scenario interrupted before its own terminal Then step ever runs.
  await new Promise(() => {});
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err}\n`);
  process.exit(1);
});
