const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseArgs,
  fleetRendezvousDir,
  fleetStatusPath,
  heartbeatIsSessionAlive,
  buildFleetStatusDoc,
  emitFleetStatus,
  main,
} = require('../out/tools/emit-fleet-status');

// BL-437: emit-fleet-status.js is the ONE place that reconstructs a swarm's
// status from its own internal roles.tsv/heartbeat files (moved here from
// fleet-console.ts, which is now a dumb merger of published docs) - drives
// the REAL compiled createSwarmNode against a real target repo fixture.

function mkTmp() {
  return mkTmpDir('sfvc-emit-fleet-status-');
}

function writeRolesTsv(targetPath, rows) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function writeHeartbeat(targetPath, role, lastBeatIso, inFlight = false) {
  const dir = path.join(targetPath, '.swarmforge', 'heartbeat');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${role}.yaml`),
    `role: ${role}\npid: 1\nlast_beat: "${lastBeatIso}"\nlast_tool: Read\nphase: exit\nin_flight: ${inFlight}\nbeat_count: 1\n`
  );
}

function writeSwarmName(targetPath, name) {
  fs.mkdirSync(path.join(targetPath, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'swarmforge', 'swarmforge.conf'), `config swarm_name ${name}\n`);
}

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs returns the target repo path when present', () => {
  assert.deepEqual(parseArgs(['/target']), { targetRepoPath: '/target' });
});

test('parseArgs returns null when no arguments are given', () => {
  assert.equal(parseArgs([]), null);
});

// ── fleetRendezvousDir / fleetStatusPath ─────────────────────────────────

test('fleetRendezvousDir honors the SWARMFORGE_FLEET_DIR override, never touching the real home directory in a test', () => {
  assert.equal(fleetRendezvousDir({ SWARMFORGE_FLEET_DIR: '/tmp/fake-fleet-dir' }), '/tmp/fake-fleet-dir');
});

test('fleetStatusPath nests the swarm name under the rendezvous dir', () => {
  assert.equal(fleetStatusPath('fes', { SWARMFORGE_FLEET_DIR: '/tmp/fake-fleet-dir' }), path.join('/tmp/fake-fleet-dir', 'fes', 'status.json'));
});

// ── heartbeatIsSessionAlive (moved here from fleet-console.ts) ───────────

test('heartbeatIsSessionAlive reports alive for a fresh heartbeat', () => {
  const targetPath = mkTmp();
  writeHeartbeat(targetPath, 'coder', new Date().toISOString());

  const isAlive = heartbeatIsSessionAlive(targetPath);

  assert.equal(isAlive({ role: 'coder' }), true);
});

test('heartbeatIsSessionAlive reports dead for a role with no heartbeat file at all', () => {
  const targetPath = mkTmp();

  const isAlive = heartbeatIsSessionAlive(targetPath);

  assert.equal(isAlive({ role: 'coder' }), false);
});

test('heartbeatIsSessionAlive reports dead for a stale (long past dead-timeout) heartbeat', () => {
  const targetPath = mkTmp();
  writeHeartbeat(targetPath, 'coder', new Date(Date.now() - 10 * 60 * 1000).toISOString());

  const isAlive = heartbeatIsSessionAlive(targetPath);

  assert.equal(isAlive({ role: 'coder' }), false);
});

// Both 'alive' and 'stuck' count as alive here (a stuck role is still a
// live process, just wedged on a tool call) - without this test, only the
// 'alive' disjunct is ever exercised, so a mutant collapsing `=== 'stuck'`
// away survives undetected.
test('heartbeatIsSessionAlive reports alive for a stuck (in-flight past the in-flight timeout) heartbeat', () => {
  const targetPath = mkTmp();
  writeHeartbeat(targetPath, 'coder', new Date(Date.now() - 90 * 1000).toISOString(), true);

  const isAlive = heartbeatIsSessionAlive(targetPath);

  assert.equal(isAlive({ role: 'coder' }), true);
});

// ── buildFleetStatusDoc / emitFleetStatus ────────────────────────────────

test('buildFleetStatusDoc carries identity, status, health, children, needs_human, and updated_at', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [
    ['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude'],
    ['coder', 'coder', targetPath, 'session', 'Coder', 'claude'],
  ]);
  writeHeartbeat(targetPath, 'coordinator', new Date().toISOString());
  writeHeartbeat(targetPath, 'coder', new Date().toISOString());
  writeSwarmName(targetPath, 'fes');

  const doc = buildFleetStatusDoc(targetPath, Date.parse('2026-07-15T20:00:00.000Z'));

  assert.equal(doc.identity.name, 'fes');
  assert.equal(doc.identity.kind, 'swarm');
  assert.equal(doc.identity.coordinatorAddress, 'fes/coordinator');
  assert.ok(doc.status);
  assert.equal(doc.health.expected_panes, 2);
  assert.equal(doc.health.live_panes, 2);
  assert.equal(doc.children.length, 1, 'expected one non-coordinator child (coder)');
  assert.equal(doc.children[0].identity.name, 'coder');
  assert.equal(doc.needs_human, false);
  assert.equal(doc.updated_at, '2026-07-15T20:00:00.000Z');
});

test('buildFleetStatusDoc defaults the swarm name to "primary" when no swarm_name is configured', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);

  const doc = buildFleetStatusDoc(targetPath);

  assert.equal(doc.identity.name, 'primary');
});

test('emitFleetStatus writes the doc to <rendezvous-dir>/<swarm-name>/status.json', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);
  writeSwarmName(targetPath, 'fes');
  const rendezvousDir = mkTmp();

  const doc = emitFleetStatus(targetPath, Date.now(), { SWARMFORGE_FLEET_DIR: rendezvousDir });

  const written = JSON.parse(fs.readFileSync(path.join(rendezvousDir, 'fes', 'status.json'), 'utf8'));
  assert.deepEqual(written, doc);
});

test('emitFleetStatus overwrites a previously-published doc on the next call (never accumulates)', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);
  writeSwarmName(targetPath, 'fes');
  const rendezvousDir = mkTmp();

  emitFleetStatus(targetPath, Date.parse('2026-07-15T20:00:00.000Z'), { SWARMFORGE_FLEET_DIR: rendezvousDir });
  emitFleetStatus(targetPath, Date.parse('2026-07-15T20:00:05.000Z'), { SWARMFORGE_FLEET_DIR: rendezvousDir });

  const written = JSON.parse(fs.readFileSync(path.join(rendezvousDir, 'fes', 'status.json'), 'utf8'));
  assert.equal(written.updated_at, '2026-07-15T20:00:05.000Z');
});

// ── main() wiring ──────────────────────────────────────────────────────

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'emit-fleet-status.js');

async function runCli(args) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', CLI_PATH, ...args];
    process.exitCode = undefined;
    await main();
    return { exitCode: process.exitCode ?? 0, output: writes.join('') };
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

test('main() prints usage and exits non-zero when the target repo path is missing', async () => {
  const result = await runCli([]);
  assert.notEqual(result.exitCode, 0);
});

test('main() emits the status doc and prints it to stdout', async () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);
  const rendezvousDir = mkTmp();
  const previousEnv = process.env.SWARMFORGE_FLEET_DIR;
  process.env.SWARMFORGE_FLEET_DIR = rendezvousDir;
  try {
    const { exitCode, output } = await runCli([targetPath]);
    assert.equal(exitCode, 0);
    const printed = JSON.parse(output);
    assert.equal(printed.identity.name, 'primary');
    assert.ok(fs.existsSync(path.join(rendezvousDir, 'primary', 'status.json')));
  } finally {
    if (previousEnv === undefined) delete process.env.SWARMFORGE_FLEET_DIR;
    else process.env.SWARMFORGE_FLEET_DIR = previousEnv;
  }
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and publishes the status doc', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);
  const rendezvousDir = mkTmp();

  const output = execFileSync('node', [CLI_PATH, targetPath], { encoding: 'utf8', env: { ...process.env, SWARMFORGE_FLEET_DIR: rendezvousDir } });
  const printed = JSON.parse(output);

  assert.equal(printed.identity.name, 'primary');
  assert.ok(fs.existsSync(path.join(rendezvousDir, 'primary', 'status.json')));
});
