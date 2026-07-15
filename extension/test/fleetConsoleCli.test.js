const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/fleet-console');

// BL-437: the compiled fleet-console CLI actually runs headless over TWO
// independently-published status.json docs (fes, primary - each written by
// its OWN swarm's emit-fleet-status.js, never a shared config file) and
// prints a composite fleet view - proving "one console, two swarms, no
// registration" has a runnable command today, not just a tested-in-
// isolation rollup module.

function mkTmp() {
  return mkTmpDir('sfvc-fleet-console-cli-');
}

function publishStatus(rendezvousDir, swarmName, doc) {
  const dir = path.join(rendezvousDir, swarmName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(doc));
}

function fixtureDoc(name, overrides = {}) {
  return {
    identity: { name, project: `proj-${name}`, kind: 'swarm', coordinatorAddress: `${name}/coordinator` },
    status: 'idle',
    health: { expected_panes: 2, live_panes: 2, coordinator_alive: true },
    children: [],
    needs_human: false,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'fleet-console.js');

function runCliSubprocess(rendezvousDir) {
  const args = rendezvousDir !== undefined ? [CLI_PATH, rendezvousDir] : [CLI_PATH];
  const output = execFileSync('node', args, { encoding: 'utf8' });
  return JSON.parse(output);
}

// Runs the REAL main() in-process, so in-process coverage and mutation
// tooling can see the branches a subprocess-only smoke test cannot (mirrors
// notifyDeadLettersCli.test.js's own identical seam).
async function runCli(rendezvousDir) {
  const previousArgv = process.argv;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = rendezvousDir !== undefined ? ['node', CLI_PATH, rendezvousDir] : ['node', CLI_PATH];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
  }
  return JSON.parse(writes.join(''));
}

test('a single published swarm renders through the SAME CLI with no special-case output shape', async () => {
  const rendezvousDir = mkTmp();
  publishStatus(rendezvousDir, 'alpha', fixtureDoc('alpha'));

  const rendered = await runCli(rendezvousDir);

  assert.equal(rendered.identity.kind, 'fleet');
  assert.equal(rendered.swarms.length, 1);
  assert.equal(rendered.swarms[0].identity.name, 'alpha');
});

test('an empty rendezvous dir (no swarm has published yet) never throws - an empty fleet', async () => {
  const rendered = await runCli(mkTmp());
  assert.deepEqual(rendered.swarms, []);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and lists two independently-published swarms rolled up to a fleet', () => {
  const rendezvousDir = mkTmp();
  publishStatus(rendezvousDir, 'alpha', fixtureDoc('alpha', { status: 'idle', health: { expected_panes: 2, live_panes: 2, coordinator_alive: true } }));
  publishStatus(rendezvousDir, 'beta', fixtureDoc('beta', { status: 'active', health: { expected_panes: 2, live_panes: 2, coordinator_alive: true } }));

  const rendered = runCliSubprocess(rendezvousDir);

  assert.equal(rendered.identity.kind, 'fleet');
  assert.deepEqual(
    rendered.swarms.map((s) => s.identity.name).sort(),
    ['alpha', 'beta']
  );
  const alphaSwarm = rendered.swarms.find((s) => s.identity.name === 'alpha');
  assert.equal(alphaSwarm.identity.project, 'proj-alpha');
  assert.equal(alphaSwarm.status, 'idle');
  const betaSwarm = rendered.swarms.find((s) => s.identity.name === 'beta');
  assert.equal(betaSwarm.status, 'active');
  assert.equal(rendered.health.expected_panes, 4);
  assert.equal(rendered.health.live_panes, 4);
});

test('the compiled CLI defaults to the SWARMFORGE_FLEET_DIR env var when no rendezvous-dir argument is given', () => {
  const rendezvousDir = mkTmp();
  publishStatus(rendezvousDir, 'alpha', fixtureDoc('alpha'));

  const output = execFileSync('node', [CLI_PATH], { encoding: 'utf8', env: { ...process.env, SWARMFORGE_FLEET_DIR: rendezvousDir } });
  const rendered = JSON.parse(output);

  assert.equal(rendered.swarms.length, 1);
  assert.equal(rendered.swarms[0].identity.name, 'alpha');
});
