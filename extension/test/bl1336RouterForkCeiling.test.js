'use strict';

// BL-1336: the fork ceiling recognises a mono-router topology.
const assert = require('node:assert/strict');
const {
  resolveVitestForkCeiling,
  resolveVitestWorkerPool,
  ROUTER_FORK_CEILING,
  MAX_WORKERS,
} = require('../out/tools/vitest-worker-memory-budget');

test('BL-1336: a router pack raises the ceiling above the default', () => {
  assert.equal(
    resolveVitestForkCeiling({ pack: 'mono-router', platform: 'linux', rotation: 'router' }),
    ROUTER_FORK_CEILING,
  );
  assert.ok(ROUTER_FORK_CEILING > MAX_WORKERS, 'the router ceiling must be ABOVE the default to mean anything');
});

test('BL-1336: the same pack in sequential mode keeps the default', () => {
  assert.equal(
    resolveVitestForkCeiling({ pack: 'mono-router', platform: 'linux', rotation: 'sequential' }),
    MAX_WORKERS,
  );
});

test('BL-1336: an absent rotation signal behaves exactly as before', () => {
  // The ordinary developer case: no swarm, so no signal.
  assert.equal(resolveVitestForkCeiling({ pack: 'mono-router', platform: 'linux' }), MAX_WORKERS);
  assert.equal(resolveVitestForkCeiling({ pack: undefined, platform: 'linux' }), MAX_WORKERS);
});

test('BL-1336: the full-forge-on-darwin ceiling of 1 is unchanged', () => {
  assert.equal(resolveVitestForkCeiling({ pack: 'full-forge', platform: 'darwin' }), 1);
  // Even were a rotation signal present, that pack's ceiling does not move.
  assert.equal(
    resolveVitestForkCeiling({ pack: 'full-forge', platform: 'darwin', rotation: 'router' }),
    1,
  );
});

test('BL-1336: an explicit override still wins over every rule', () => {
  assert.equal(
    resolveVitestForkCeiling({ pack: 'mono-router', platform: 'linux', rotation: 'router', override: '2' }),
    2,
  );
});

test('BL-1336: the memory budget still binds on a small host', () => {
  // A host with far too little RAM for the raised ceiling: the pool is what
  // memory allows, never the ceiling.
  const small = resolveVitestWorkerPool({
    pack: 'mono-router',
    platform: 'linux',
    rotation: 'router',
    hostRamMB: 2048,
  });
  assert.ok(small < ROUTER_FORK_CEILING, `the raised ceiling widened the pool past the RAM budget: ${small}`);

  // And on a large host the ceiling is what binds.
  const large = resolveVitestWorkerPool({
    pack: 'mono-router',
    platform: 'linux',
    rotation: 'router',
    hostRamMB: 512 * 1024,
  });
  assert.equal(large, ROUTER_FORK_CEILING);
});
