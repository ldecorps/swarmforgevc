'use strict';

// BL-1703's declared invariant: "No seat of a pack that uses the local
// model endpoint is started unless the endpoint answered the launch's
// probe." Two parts, tested separately because they quantify over two
// different things:
//
// 1. The LIB's own contract (a pure, testable module): when the endpoint
//    never answers, ensure_ollama_ancillary_ensure_ready_for_launch
//    refuses (nonzero) and leaves no process it started still running -
//    generalized here over randomized wait/poll-interval/port
//    combinations, beyond the acceptance feature's one fixed case.
// 2. The CALL-SITE ordering that actually keeps a seat from starting
//    (swarmforge.sh: the probe/start call runs before every
//    create_role_session/launch_role call) - this is a property of THIS
//    parcel's own diff (which script line precedes which), not of a
//    reusable module a generator can drive; encoded as a direct source
//    check against the real file, the same population the wiring anchor
//    itself names.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeOllamaAncillaryFixture } = require('./helpers/ollamaAncillaryFixture');

const SWARMFORGE_SH = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'swarmforge.sh');

test('invariant: the probe/start call precedes every seat-creation call in swarmforge.sh', () => {
  const text = fs.readFileSync(SWARMFORGE_SH, 'utf8');
  const lines = text.split('\n');

  const callLine = lines.findIndex((l) => l.trim() === 'ensure_ollama_ancillary_for_launch');
  assert.ok(callLine >= 0, 'expected a call to ensure_ollama_ancillary_for_launch in swarmforge.sh');

  const seatCreationPatterns = [/create_role_session "/, /^\s*launch_role "\$i"/];
  const seatCreationLines = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => seatCreationPatterns.some((re) => re.test(l)))
    .map(({ i }) => i);

  assert.ok(seatCreationLines.length >= 2, 'reach floor: expected to find both seat-creation call sites');
  for (const seatLine of seatCreationLines) {
    assert.ok(
      callLine < seatLine,
      `expected the probe/start call (line ${callLine + 1}) before every seat-creation call - found one at line ${seatLine + 1}`
    );
  }
});

// A small, fully enumerable space (2 wait values x 2 poll intervals) -
// constructed exhaustively rather than fc-sampled, so every combination is
// reached by construction instead of hoped for from a handful of draws
// (BL-1691's own precedent for a state space this small).
const WAIT_SECONDS_VALUES = [1, 2];
const POLL_INTERVAL_VALUES = [1, 2];

test('invariant: a never-answering endpoint refuses the launch and leaves no started process running, across wait/poll combinations', () => {
  const reach = new Set();
  for (const waitSeconds of WAIT_SECONDS_VALUES) {
    for (const pollInterval of POLL_INTERVAL_VALUES) {
      reach.add(`${waitSeconds}:${pollInterval}`);
      const fx = makeOllamaAncillaryFixture();
      try {
        fx.setMode('never');
        const stateDir = path.join(fx.root, 'state');
        const port = 20000 + Math.floor(Math.random() * 20000);
        const result = fx.run({
          usesLocal: 'yes',
          url: `http://127.0.0.1:${port}/v1`,
          stateDir,
          binary: 'ollama',
          waitSeconds,
          pollInterval,
          logPath: path.join(stateDir, 'ollama', 'serve.log'),
          port,
        });
        assert.equal(
          result.status,
          1,
          `wait=${waitSeconds} poll=${pollInterval}: expected exit 1, got ${result.status}`
        );
        assert.equal(fx.readRecord(stateDir), null, 'expected no ollama record');
        const startedPid = fx.startedServerPid();
        assert.ok(startedPid, 'expected the launch to have started a server to check');
        assert.equal(fx.pidAlive(startedPid), false, `expected pid ${startedPid} to be stopped`);
      } finally {
        fx.cleanup();
      }
    }
  }
  assert.equal(reach.size, WAIT_SECONDS_VALUES.length * POLL_INTERVAL_VALUES.length);
});
