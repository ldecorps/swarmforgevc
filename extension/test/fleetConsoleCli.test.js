const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BL-246: the compiled fleet-console CLI actually runs headless over TWO
// independent projects (alpha, beta - each its own .swarmforge/roles.tsv,
// neither sharing a targetPath with the other) and prints a composite
// fleet view - proving "one console, two swarms" has a runnable command
// today, not just a tested-in-isolation rollup module.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-fleet-console-cli-'));
}

function writeRolesTsv(targetPath, rows) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function writeHeartbeat(targetPath, role, lastBeatIso) {
  const dir = path.join(targetPath, '.swarmforge', 'heartbeat');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${role}.yaml`),
    `role: ${role}\npid: 1\nlast_beat: "${lastBeatIso}"\nlast_tool: Read\nphase: exit\nin_flight: false\nbeat_count: 1\n`
  );
}

function markBacklogActive(targetPath) {
  const dir = path.join(targetPath, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'BL-999-fixture.yaml'), 'id: BL-999\n');
}

test('the compiled fleet-console CLI lists two independently-rooted swarms with their status, rolled up to a fleet', () => {
  const alphaPath = mkTmp();
  writeRolesTsv(alphaPath, [
    ['coordinator', 'master', alphaPath, 'session', 'Coordinator', 'claude'],
    ['coder', 'coder', alphaPath, 'session', 'Coder', 'claude'],
  ]);
  writeHeartbeat(alphaPath, 'coordinator', new Date().toISOString());
  writeHeartbeat(alphaPath, 'coder', new Date().toISOString());
  markBacklogActive(alphaPath);

  const betaPath = mkTmp();
  writeRolesTsv(betaPath, [
    ['coordinator', 'master', betaPath, 'session', 'Coordinator', 'claude'],
    ['coder', 'coder', betaPath, 'session', 'Coder', 'claude'],
  ]);
  writeHeartbeat(betaPath, 'coordinator', new Date().toISOString());
  writeHeartbeat(betaPath, 'coder', new Date().toISOString());
  // beta gets no active backlog item and no queued/in-process handoff - all
  // idle with nothing left rolls up to swarm 'done', distinct from alpha.

  const configFile = path.join(mkTmp(), 'fleet.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify([
      { name: 'alpha', project: 'proj-a', targetPath: alphaPath },
      { name: 'beta', project: 'proj-b', targetPath: betaPath },
    ])
  );

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'fleet-console.js');
  const output = execFileSync('node', [cliPath, configFile], { encoding: 'utf8' });
  const rendered = JSON.parse(output);

  assert.equal(rendered.identity.kind, 'fleet');
  assert.deepEqual(
    rendered.swarms.map((s) => s.identity.name),
    ['alpha', 'beta']
  );
  const alphaSwarm = rendered.swarms.find((s) => s.identity.name === 'alpha');
  const betaSwarm = rendered.swarms.find((s) => s.identity.name === 'beta');
  assert.equal(alphaSwarm.identity.project, 'proj-a');
  assert.equal(alphaSwarm.status, 'idle');
  assert.equal(betaSwarm.status, 'done');
  assert.equal(rendered.health.expected_panes, 4);
  assert.equal(rendered.health.live_panes, 4);
});

test('a single-swarm fleet config runs through the SAME CLI with no special-case output shape', () => {
  const alphaPath = mkTmp();
  writeRolesTsv(alphaPath, [['coordinator', 'master', alphaPath, 'session', 'Coordinator', 'claude']]);
  writeHeartbeat(alphaPath, 'coordinator', new Date().toISOString());

  const configFile = path.join(mkTmp(), 'fleet.json');
  fs.writeFileSync(configFile, JSON.stringify([{ name: 'alpha', project: 'proj-a', targetPath: alphaPath }]));

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'fleet-console.js');
  const output = execFileSync('node', [cliPath, configFile], { encoding: 'utf8' });
  const rendered = JSON.parse(output);

  assert.equal(rendered.identity.kind, 'fleet');
  assert.equal(rendered.swarms.length, 1);
  assert.equal(rendered.swarms[0].identity.name, 'alpha');
});

test('the CLI exits non-zero with a usage message when the config file argument is missing', () => {
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'fleet-console.js');
  assert.throws(() => execFileSync('node', [cliPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
});
