'use strict';

// BL-746: shared fixture builder for a REAL repo-root stop-swarm.sh run - a
// byte-identical runtime copy resolves its own three helpers via its own
// SCRIPT_DIR seam, so copying it into the fixture root IS invoking the
// script itself. Used by both bl746StopSwarmRealRefuseGatesSteps.js (the
// acceptance step handlers) and
// swarmforge/scripts/test/bl746_stop_swarm_refuse_gate_property_runner.js
// (the invariant-2 exhaustive property test) so the two never drift.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const STOP_SWARM_SRC = path.join(REPO_ROOT, 'stop-swarm.sh');
const SURVIVOR_SCAN_SRC = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'stack_survivor_scan.sh');

function writeKillStub(root, exitCode) {
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'scripts', 'kill_pipeline_swarm.sh'),
    `#!/usr/bin/env bash\necho "stub kill_pipeline ok"\nexit ${exitCode}\n`,
    { mode: 0o755 },
  );
}

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl746-stop-fixture-'));
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });

  fs.copyFileSync(STOP_SWARM_SRC, path.join(root, 'stop-swarm.sh'));
  fs.chmodSync(path.join(root, 'stop-swarm.sh'), 0o755);
  fs.copyFileSync(SURVIVOR_SCAN_SRC, path.join(root, 'swarmforge', 'scripts', 'stack_survivor_scan.sh'));

  // stop-swarm.sh runs this UNGUARDED under `set -e` - must always exit 0.
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'scripts', 'stop_ancillary_services.sh'),
    '#!/usr/bin/env bash\necho "stub stop_ancillary ok"\n',
    { mode: 0o755 },
  );
  writeKillStub(root, 0);

  const psFile = path.join(root, 'ps.txt');
  fs.writeFileSync(psFile, '  1 init\n');

  return { root, psFile };
}

function setSurvivor(fixture, argv) {
  fs.writeFileSync(fixture.psFile, `  1 init\n1234 ${argv}\n`);
}

function setNoSurvivors(fixture) {
  fs.writeFileSync(fixture.psFile, '  1 init\n');
}

function runStopSwarm(fixture, { timeout = 30000 } = {}) {
  return spawnSync('bash', [path.join(fixture.root, 'stop-swarm.sh'), fixture.root], {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, SWARMFORGE_SURVIVOR_PS_FILE: fixture.psFile },
  });
}

// BL-746 architect bounce (fixture root leaked, no cleanup path): mirrors
// bl886SupervisorFixture.js's own cleanupFixtureRoot exactly, so both
// callers (the acceptance step handlers and the property runner) reclaim
// every mkdtemp'd root they build.
function cleanupFixtureRoot(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

module.exports = { buildFixture, writeKillStub, setSurvivor, setNoSurvivors, runStopSwarm, cleanupFixtureRoot };
