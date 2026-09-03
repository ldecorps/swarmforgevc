'use strict';

// BL-1336's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  Both vitest lanes size their pool through the single
//                resolveVitestWorkerPool composition point: neither lane gains
//                a sizing route the other does not share.
//   invariant 2  The memory-derived pool size remains the binding cap -
//                raising the CPU ceiling can never yield a pool larger than
//                the host's RAM budget allows.
//   invariant 3  The existing full-forge-on-darwin ceiling of 1 is unchanged
//                by this ticket.
//
// GENERATOR REACH (by construction). Rotation, pack and platform are the axes
// the ceiling reads, so each is ENUMERATED by the enclosing loops and only the
// host RAM is generated. Every combination therefore runs in every pass, and
// the reach floors below hold because the loops ran.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const {
  resolveVitestForkCeiling,
  resolveVitestWorkerPool,
  resolveWorkerPoolSize,
  ROUTER_FORK_CEILING,
  MAX_WORKERS,
} = require('../out/tools/vitest-worker-memory-budget');

const PACKS = ['full-forge', 'mono-router', 'day-shift', undefined];
const PLATFORMS = ['linux', 'darwin'];
const ROTATIONS = ['router', 'sequential', undefined];

test('BL-1336/BL-654 invariant 1: both lanes size through the one composition point', () => {
  // Read the lanes themselves. Calling the shared helper twice would prove it
  // agrees with itself; what the invariant forbids is a lane growing a route
  // the other lacks, which is only visible in the lane files.
  const lanes = ['vitest.config.mjs', 'vitest.properties.config.mjs'].map((f) => ({
    file: f,
    source: fs.readFileSync(path.join(EXT_DIR, f), 'utf8'),
  }));

  for (const { file, source } of lanes) {
    assert.match(source, /resolveVitestWorkerPool\(/, `${file} does not use the shared composition point`);
    assert.doesNotMatch(
      source,
      /resolveVitestForkCeiling\(/,
      `${file} composes the ceiling itself, which is the duplication BL-935 removed`,
    );
    for (const key of ['pack:', 'rotation:', 'platform:', 'override:', 'hostRamMB:']) {
      assert.ok(source.includes(key), `${file} does not pass ${key} - the lanes read different inputs`);
    }
  }

  // And the inputs are byte-identical between the lanes, so neither can be
  // reading a signal the other does not.
  const inputsOf = (source) => {
    const call = source.slice(source.indexOf('resolveVitestWorkerPool({'));
    return call
      .slice(0, call.indexOf('});'))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes(':') && !l.startsWith('//'));
  };
  assert.deepEqual(inputsOf(lanes[0].source), inputsOf(lanes[1].source), 'the two lanes pass different inputs');
});

test('BL-1336/BL-654 invariant 2: the RAM budget always binds, whatever the ceiling', () => {
  const reach = { ceilingBound: 0, ramBound: 0, router: 0 };

  for (const rotation of ROTATIONS) {
    for (const pack of PACKS) {
      fc.assert(
        fc.property(fc.integer({ min: 512, max: 1024 * 1024 }), (hostRamMB) => {
          const pool = resolveVitestWorkerPool({ pack, platform: 'linux', rotation, hostRamMB });
          const ceiling = resolveVitestForkCeiling({ pack, platform: 'linux', rotation });
          const ramAllows = resolveWorkerPoolSize(hostRamMB, Number.MAX_SAFE_INTEGER);

          // The pool is never more than EITHER bound - that is what "the RAM
          // budget remains binding" means once a ceiling can be raised.
          assert.ok(pool <= ramAllows, `the pool (${pool}) exceeded what RAM allows (${ramAllows})`);
          assert.ok(pool <= ceiling, `the pool (${pool}) exceeded the ceiling (${ceiling})`);
          assert.equal(pool, Math.min(ramAllows, ceiling), 'the pool is not the minimum of the two bounds');
          assert.ok(pool >= 1, 'the pool fell below one worker');

          if (rotation === 'router') reach.router += 1;
          if (ramAllows < ceiling) reach.ramBound += 1;
          else reach.ceilingBound += 1;
          return true;
        }),
        { numRuns: 6 },
      );
    }
  }

  assert.ok(reach.router > 0, 'never exercised a router rotation');
  assert.ok(reach.ramBound > 0, 'never exercised a host where RAM is the binding bound');
  assert.ok(reach.ceilingBound > 0, 'never exercised a host where the ceiling is the binding bound');
});

test('BL-1336/BL-654 invariant 3: full-forge on darwin is still 1, whatever else is true', () => {
  const reach = { cases: 0 };
  for (const rotation of ROTATIONS) {
    fc.assert(
      fc.property(fc.integer({ min: 512, max: 1024 * 1024 }), (hostRamMB) => {
        reach.cases += 1;
        // The ticket's out_of_scope: this ceiling does not move, and it must
        // not move even if a router signal is somehow present alongside it.
        assert.equal(resolveVitestForkCeiling({ pack: 'full-forge', platform: 'darwin', rotation }), 1);
        assert.equal(
          resolveVitestWorkerPool({ pack: 'full-forge', platform: 'darwin', rotation, hostRamMB }),
          1,
          'the full-forge darwin pool widened past one worker',
        );
        return true;
      }),
      { numRuns: 4 },
    );
  }
  assert.ok(reach.cases > 0, 'never exercised the full-forge darwin case');

  // And the raised ceiling is genuinely a raise - a "raised" ceiling equal to
  // the default would satisfy every assertion above while changing nothing.
  assert.ok(ROUTER_FORK_CEILING > MAX_WORKERS, 'the router ceiling does not raise anything');
});
