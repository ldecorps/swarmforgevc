#!/usr/bin/env node
'use strict';

// BL-746 architect bounce (fixture root leaked, no cleanup path): unit
// test for bl746StopSwarmFixture.js's cleanup contract, mirroring
// bl886SupervisorFixture.js's own cleanupFixtureRoot precedent (mkdtemp'd
// root removed via fs.rmSync after the fixture is done being used).
// Fails against the pre-fix lib (no cleanupFixtureRoot export at all) and
// against a plausible wrong fix (a cleanup that no-ops or only removes a
// child path instead of the whole fixture root).

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const fixtureLib = require(path.join(__dirname, '..', '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'bl746StopSwarmFixture'));

function main() {
  assert.strictEqual(
    typeof fixtureLib.cleanupFixtureRoot,
    'function',
    'bl746StopSwarmFixture.js must export cleanupFixtureRoot',
  );

  const fixture = fixtureLib.buildFixture();
  assert.ok(fs.existsSync(fixture.root), 'buildFixture must create the fixture root');

  fixtureLib.cleanupFixtureRoot(fixture);
  assert.ok(!fs.existsSync(fixture.root), 'cleanupFixtureRoot must remove the fixture root');

  // Idempotent: calling it again on an already-removed root must not throw
  // (mirrors bl886SupervisorFixture.js's cleanupFixtureRoot, called
  // unconditionally by every terminal step / property-runner iteration).
  fixtureLib.cleanupFixtureRoot(fixture);

  console.log('bl746 stop-swarm fixture cleanup: PASS');
  process.exit(0);
}

main();
