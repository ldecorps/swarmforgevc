'use strict';

// BL-1061 property test (coder-authored, two DECLARED invariants).
//
//   Invariant 1: "A tunnel-ownership fixture never binds a name any process
//   outside the run could be serving: the name is unique to the run, and a
//   reap the run performs can only ever select a pid that run created."
//
//   Invariant 2: "The suite leaves no cloudflared-shaped process alive past
//   its own run; a fixture leaked by an earlier run is not alive by the time
//   any assertion reads the process table."
//
// The decision half runs against the PURE seam the lib already provides -
// tunnel_decide_orphans reads candidate lines on stdin and never calls pgrep
// or kill - so a property can feed it a process table containing the
// operator's REAL tunnel line without any process being at risk. Driving the
// real edge to assert "the real tunnel survives" would mean putting the real
// tunnel in range of a reap to prove it is out of range, which is the fault
// this ticket exists to remove.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// The dangerous pair is a NEAR MISS: a bystander whose name shares a boundary
// with the target, where a substring match would select it and a word-boundary
// match must not. Drawing two names independently makes a near miss
// essentially impossible - two random names simply differ - so the bystander
// is DERIVED FROM the target by the transformations a sloppy matcher would
// conflate (suffix, prefix, embedded, and the target itself as a substring of
// a longer name). Every generated pair is a collision candidate by
// construction, and each transformation's reach is floored.
//
// The operator's real production line is injected into the candidate table at
// a fixed rate, because the single most important thing this property asserts
// is that it is never selected - and a generator that rarely includes it
// rarely asserts that.
//
// Non-vacuity PROVEN at authoring time (2026-08-22), each break restored:
//   - match the name as a bare substring instead of a run-token pair ... P1b
//   - drop the PRODUCTION_TUNNEL_NAMES refusal ......................... P1a
//   - sweep leaked fixtures by tunnel name instead of temp path ........ P2

const assert = require('node:assert/strict');
const fc = require('fast-check');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  PRODUCTION_TUNNEL_NAMES,
  fixtureTunnelName,
  isProductionTunnelName,
  assertFixtureTunnelName,
  leakedFixtureTunnelPids,
} = require('./helpers/fixtureTunnelName');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'tunnel_ownership_lib.sh');

// The operator's real tunnel, in the exact shape `ps -o pid=,args=` prints it.
const REAL_TUNNEL_PID = 316866;
const REAL_TUNNEL_LINE =
  `${REAL_TUNNEL_PID} /home/operator/.local/bin/cloudflared tunnel ` +
  `--config /home/operator/.cloudflared/config.yml --no-autoupdate run swarmforge-bubble`;

function decideOrphans(name, lines, protectedPids = []) {
  const res = spawnSync('bash', [LIB, 'decide-orphans', name, ...protectedPids.map(String)], {
    input: `${lines.join('\n')}\n`,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `decide-orphans failed: ${res.stderr}`);
  return (res.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean).map(Number);
}

function fixtureLine(pid, name) {
  return `${pid} bash ${os.tmpdir()}/bl1061-fixture-${pid}/cloudflared tunnel --config /x/c.yml --no-autoupdate run ${name}`;
}

// BL-1287: a name in fixtureTunnelName()'s own shape but with an EXPLICIT
// creator pid, for constructing a synthetic "leaked by a run that is
// gone" fixture line - fixtureTunnelName() itself always embeds THIS
// (live) test process's own pid, which is the wrong shape for a fixture
// meant to model one whose creator has already exited.
function fixtureTunnelNameWithCreator(creatorPid, label) {
  const safeLabel = String(label).replace(/[^A-Za-z0-9-]/g, '-');
  return `sfvc-test-${creatorPid}-${Math.floor(Math.random() * 1e6)}-${safeLabel}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Invariant 1, first half: the name itself. ─────────────────────────────

test('property (invariant 1): a fixture name is unique to the run and never a production name', () => {
  const seen = new Set();
  fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 12 }), (label) => {
      const name = fixtureTunnelName(label);
      assert.equal(isProductionTunnelName(name), false, `generated a production name: ${name}`);
      assert.equal(seen.has(name), false, `fixtureTunnelName collided with an earlier name: ${name}`);
      seen.add(name);
      assert.doesNotThrow(() => assertFixtureTunnelName(name));
    }),
    { numRuns: 300 }
  );
  assert.equal(seen.size, 300, `expected 300 distinct names, got ${seen.size}`);

  // Anchored before the loop, because a `for (const x of LIST)` over an EMPTY
  // list passes without executing its body - emptying PRODUCTION_TUNNEL_NAMES
  // would then leave this test green while the guard refused nothing. Caught
  // by the non-vacuity break; the list's CONTENT is what is asserted here,
  // not merely the behaviour of whatever happens to be in it.
  assert.ok(PRODUCTION_TUNNEL_NAMES.includes('swarmforge-bubble'),
    'swarmforge-bubble must be on the refusal list - it is the operator\'s live tunnel name');
  assert.ok(PRODUCTION_TUNNEL_NAMES.length >= 1);
  for (const prod of PRODUCTION_TUNNEL_NAMES) {
    assert.throws(() => assertFixtureTunnelName(prod), /may not bind the production tunnel name/,
      `${prod} must be refused, or the guard is decorative`);
  }
});

// ── Invariant 1, second half: what a reap may select. ─────────────────────

const NEAR_MISS = {
  suffixed: (t) => `${t}-staging`,
  prefixed: (t) => `old-${t}`,
  embedded: (t) => `x${t}x`,
  longer: (t) => `${t}${t}`,
};

test('property (invariant 1): a reap selects only pids serving the exact name, never a near miss or the real tunnel', () => {
  const reach = { suffixed: 0, prefixed: 0, embedded: 0, longer: 0, withRealTunnel: 0, withoutRealTunnel: 0 };

  fc.assert(
    fc.property(
      fc.constantFrom(...Object.keys(NEAR_MISS)),
      fc.integer({ min: 1, max: 4 }),
      fc.boolean(),
      (shape, targetCount, includeReal) => {
        const target = fixtureTunnelName('target');
        // Derived from the target, so every pair is a collision candidate.
        const bystander = NEAR_MISS[shape](target);
        reach[shape] += 1;
        reach[includeReal ? 'withRealTunnel' : 'withoutRealTunnel'] += 1;

        const targetPids = Array.from({ length: targetCount }, (_, i) => 9000 + i);
        const bystanderPid = 9500;
        const lines = [
          ...targetPids.map((pid) => fixtureLine(pid, target)),
          fixtureLine(bystanderPid, bystander),
          ...(includeReal ? [REAL_TUNNEL_LINE] : []),
        ];

        const selected = decideOrphans(target, lines);
        assert.deepEqual(selected.sort((a, b) => a - b), targetPids,
          `shape=${shape}: a reap for "${target}" selected the wrong pids`);
        assert.ok(!selected.includes(bystanderPid),
          `shape=${shape}: the near-miss name "${bystander}" was selected by a reap scoped to "${target}"`);
        assert.ok(!selected.includes(REAL_TUNNEL_PID),
          "the operator's real tunnel was selected by a reap scoped to a fixture name");
      }
    ),
    { numRuns: 200 }
  );

  for (const [k, floor] of Object.entries({ suffixed: 25, prefixed: 25, embedded: 25, longer: 25, withRealTunnel: 60, withoutRealTunnel: 60 })) {
    assert.ok(reach[k] >= floor, `the generator reached ${k} only ${reach[k]} time(s), floor ${floor}`);
  }
});

test('property (invariant 1): a protected pid is never selected even when it serves the exact name', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 4 }), fc.nat({ max: 3 }), (count, protectedSlot) => {
      const name = fixtureTunnelName('protected');
      const pids = Array.from({ length: count }, (_, i) => 8000 + i);
      const guarded = protectedSlot < count ? pids[protectedSlot] : null;
      const selected = decideOrphans(name, pids.map((pid) => fixtureLine(pid, name)), guarded ? [guarded] : []);
      if (guarded !== null) {
        assert.ok(!selected.includes(guarded), `protected pid ${guarded} was selected`);
        assert.deepEqual(selected.sort((a, b) => a - b), pids.filter((p) => p !== guarded));
      } else {
        assert.deepEqual(selected.sort((a, b) => a - b), pids);
      }
    }),
    { numRuns: 120 }
  );
});

// ── Invariant 2: the leaked-fixture sweep. ────────────────────────────────

test('property (invariant 2): the leaked-fixture sweep selects fixtures by temp path and never the real tunnel', () => {
  const reach = { withReal: 0, withoutReal: 0, withFixtures: 0, empty: 0 };
  // BL-1287: leakedFixtureTunnelPids now also asks whether each fixture's
  // OWN creator is still alive - a real, load-bearing question this
  // property's synthetic fixtures must answer honestly. A dead pid,
  // computed once (spawnSync waits for full exit before returning),
  // models "leaked by a run that is gone" for every fixture line below;
  // reusing one across the whole property (rather than spawning fresh per
  // generated case) keeps this property's own cost independent of numRuns.
  const deadCreatorPid = spawnSync('true', []).pid;

  fc.assert(
    fc.property(fc.integer({ min: 0, max: 4 }), fc.boolean(), (fixtureCount, includeReal) => {
      const fixturePids = Array.from({ length: fixtureCount }, (_, i) => 7000 + i);
      const lines = [
        ...fixturePids.map((pid) => fixtureLine(pid, fixtureTunnelNameWithCreator(deadCreatorPid, 'leaked'))),
        // A leaked fixture bound to the PRODUCTION name - the shape that was
        // actually on this host. It must still be swept: it is a fixture.
        ...(fixtureCount > 0 ? [fixtureLine(7900, 'swarmforge-bubble')] : []),
        ...(includeReal ? [REAL_TUNNEL_LINE] : []),
      ];
      reach[includeReal ? 'withReal' : 'withoutReal'] += 1;
      reach[fixtureCount > 0 ? 'withFixtures' : 'empty'] += 1;

      // A stub `ps` returning exactly this table, so the pure selection is
      // exercised without reading the host's.
      const fakeExec = () => `${lines.join('\n')}\n`;
      const selected = leakedFixtureTunnelPids(fakeExec);

      assert.ok(!selected.includes(REAL_TUNNEL_PID),
        "the sweep selected the operator's real tunnel - it must select by temp path, not by name");
      for (const pid of fixturePids) {
        assert.ok(selected.includes(pid), `leaked fixture pid ${pid} was not swept`);
      }
      if (fixtureCount > 0) {
        assert.ok(selected.includes(7900),
          'a leaked fixture bound to the production name must still be swept - it is a fixture');
      }
    }),
    { numRuns: 150 }
  );

  for (const [k, floor] of Object.entries({ withReal: 40, withoutReal: 40, withFixtures: 80, empty: 15 })) {
    assert.ok(reach[k] >= floor, `the generator reached ${k} only ${reach[k]} time(s), floor ${floor}`);
  }
});

test('property (invariant 2): no committed test fixture binds a production tunnel name', () => {
  const fs = require('node:fs');
  const testDir = __dirname;
  const offenders = [];
  for (const name of fs.readdirSync(testDir)) {
    if (!name.endsWith('.js')) continue;
    const full = path.join(testDir, name);
    if (!fs.statSync(full).isFile()) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const prod of PRODUCTION_TUNNEL_NAMES) {
      // A fixture BINDS the name when it hands it to the launcher as the
      // tunnel to serve. Mentioning it in a URL scheme or a comment is not a
      // binding, and flagging those would make the guard noise nobody reads.
      const bindRe = new RegExp(`SWARMFORGE_NAMED_TUNNEL\\s*[:=]\\s*['"\`]${prod}['"\`]`);
      if (bindRe.test(text)) offenders.push(`${name}: binds ${prod}`);
    }
  }
  assert.deepEqual(offenders, [],
    `a fixture binds a production tunnel name; the reap selects by name against the host process table: ${offenders.join('; ')}`);
});
