const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseArgs,
  readFleetConfig,
  heartbeatIsSessionAlive,
  buildSwarmNode,
  renderFleet,
} = require('../out/tools/fleet-console');
const { createFleetNode } = require('../out/swarm/fleetNode');

// BL-246: parseArgs/readFleetConfig/heartbeatIsSessionAlive/buildSwarmNode/
// renderFleet are pulled out of main() so they're exercised in-process -
// same "CLI main() run only via execFileSync is coverage-invisible" lesson
// recruiter-run.ts's/bakeoff-run.ts's own hardener passes already
// established for this codebase.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-fleet-console-'));
}

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs returns the config file when present', () => {
  assert.deepEqual(parseArgs(['fleet.json']), { configFile: 'fleet.json' });
});

test('parseArgs returns null when no arguments are given', () => {
  assert.equal(parseArgs([]), null);
});

// ── readFleetConfig ──────────────────────────────────────────────────────

test('readFleetConfig parses a JSON array of swarm registrations', () => {
  const dir = mkTmp();
  const configFile = path.join(dir, 'fleet.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify([
      { name: 'alpha', project: 'proj-a', targetPath: '/tmp/alpha' },
      { name: 'beta', project: 'proj-b', targetPath: '/tmp/beta' },
    ])
  );

  const registrations = readFleetConfig(configFile);

  assert.equal(registrations.length, 2);
  assert.equal(registrations[0].name, 'alpha');
  assert.equal(registrations[1].name, 'beta');
});

// ── heartbeatIsSessionAlive ────────────────────────────────────────────────

function writeHeartbeatFixture(targetPath, role, lastBeatIso) {
  const dir = path.join(targetPath, '.swarmforge', 'heartbeat');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${role}.yaml`),
    `role: ${role}\npid: 123\nlast_beat: "${lastBeatIso}"\nlast_tool: Read\nphase: exit\nin_flight: false\nbeat_count: 1\n`
  );
}

test('heartbeatIsSessionAlive reports alive for a fresh heartbeat', () => {
  const targetPath = mkTmp();
  writeHeartbeatFixture(targetPath, 'coder', new Date().toISOString());

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
  writeHeartbeatFixture(targetPath, 'coder', new Date(Date.now() - 10 * 60 * 1000).toISOString());

  const isAlive = heartbeatIsSessionAlive(targetPath);

  assert.equal(isAlive({ role: 'coder' }), false);
});

// ── buildSwarmNode + renderFleet (real composition, one swarm) ───────────

function writeRolesTsv(targetPath, rows) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

test('buildSwarmNode composes a real CompositeNode from a registration, readable by renderFleet', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [
    ['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude'],
    ['coder', 'coder', targetPath, 'session', 'Coder', 'claude'],
  ]);
  writeHeartbeatFixture(targetPath, 'coordinator', new Date().toISOString());
  writeHeartbeatFixture(targetPath, 'coder', new Date().toISOString());

  const swarm = buildSwarmNode({ name: 'alpha', project: 'proj-a', targetPath });

  assert.deepEqual(swarm.identity(), { name: 'alpha', project: 'proj-a', kind: 'swarm', coordinatorAddress: 'alpha/coordinator' });
  assert.equal(swarm.health().live_panes, 2);

  const fleet = createFleetNode({ fleetName: 'fleet', swarms: [swarm] });
  const rendered = renderFleet(fleet);
  assert.equal(rendered.identity.kind, 'fleet');
  assert.equal(rendered.swarms.length, 1);
  assert.equal(rendered.swarms[0].identity.name, 'alpha');
});

test('buildSwarmNode defaults coordinatorAddress from the swarm name when not given', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);

  const swarm = buildSwarmNode({ name: 'beta', project: 'proj-b', targetPath });

  assert.equal(swarm.identity().coordinatorAddress, 'beta/coordinator');
});
