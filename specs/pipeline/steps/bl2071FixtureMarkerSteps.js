'use strict';

// BL-2071: step handler for the fixture feature
// specs/pipeline/test/fixtures/bl2071-marker-pair.feature, which
// local_seat_acceptance_gate_lib.bb's own test (BL-2071) drives through the
// REAL specs/pipeline/cli.js (never a reimplementation) to prove the gate
// actually runs the ticket's acceptance feature rather than trusting a
// static check. Each marker is a plain file the test harness writes before
// invoking the pipeline, read here from SWARMFORGE_BL2071_FIXTURE_MARKER_DIR
// (an env var, so the harness can flip pass/fail between runs without
// touching this feature or this handler) - never minted as a real ticket.

const fs = require('node:fs');
const path = require('node:path');

const FEATURE = 'BL-2071 fixture: a two-scenario feature driven by marker files';

function markerPath(letter) {
  const dir = process.env.SWARMFORGE_BL2071_FIXTURE_MARKER_DIR;
  if (!dir) {
    throw new Error('SWARMFORGE_BL2071_FIXTURE_MARKER_DIR is not set');
  }
  return path.join(dir, `${letter}.txt`);
}

function registerSteps(registry) {
  registry.defineScoped(/^the bl2071 fixture marker "([^"]+)" says pass$/, (ctx, letter) => {
    const value = fs.readFileSync(markerPath(letter), 'utf8').trim();
    if (value !== 'pass') {
      throw new Error(`bl2071 fixture marker "${letter}" says "${value}", not "pass"`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
