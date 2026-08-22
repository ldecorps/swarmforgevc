// BL-1010 property test (coder-authored, two DECLARED invariants).
//
//   Invariant 1: "One resolution order everywhere: every TypeScript reader of
//   this swarm's own name resolves it identically to swarm_identity_lib.bb -
//   identity file, then conf, then the shared default - with no caller keeping
//   a private order of its own."
//
//   Invariant 2: "No cross-name write: publishing fleet status from a tree
//   whose identity names swarm X writes only under X. No input, and no absent
//   input, causes a write under any other swarm's name."
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// The state that actually failed in production is IDENTITY AND CONF
// DISAGREEING - and drawing the two names independently from a pool makes them
// coincide often enough that a run can look healthy while never testing the
// disagreement. Worse, the historical bug is invisible whenever they AGREE,
// which is exactly why it stayed hidden on the Mac for so long. So the
// disagreeing case is CONSTRUCTED: the conf name is derived from the identity
// name by a transformation guaranteed to differ, never drawn on its own. Floors
// below assert every combination was reached, the disagreement most of all.
//
// P3 is the structural half of invariant 1 and needs no generator: it reads the
// source of every readSwarmName caller and requires each to go through the one
// resolver. A property over inputs cannot catch a caller that never calls.
//
// Non-vacuity PROVEN at authoring time (2026-08-22), each break applied to the
// real source, compiled, and restored:
//
//   conf checked BEFORE identity (the pre-fix order) ..... P1 fail, P2 fail
//   identity ignored entirely (the original defect) ...... P1 fail, P2 fail
//   TS default literal drifted to "main" ................. all three PASS
//   emit-fleet-status keeps its own private order ........ P2 fail, P3 fail
//
// Two of those rows are the interesting ones, and both are recorded rather
// than tidied away:
//
//   The default-literal drift does NOT fail here, and should not: these
//   properties quantify over resolution ORDER, and every order still holds
//   when the default changes. What holds the VALUE is the cross-language
//   literal test in bl1010SwarmNameResolution.test.js (scenario 03), which
//   failed 2 of 7 on that same break. Saying so out loud matters more than a
//   clean-looking table - a reader who assumed this file covered the literal
//   would be wrong.
//
//   A caller keeping its own private order does NOT fail P1 either, because
//   P1 exercises the resolver directly and the resolver is still correct. Only
//   P2 (which publishes end to end) and P3 (which reads the callers' source)
//   catch it. That is precisely why P3 exists: a property over inputs cannot
//   catch a caller that never calls.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// BL-420: every temp root is allocated through the shared helper, so cleanup
// happens in one place. These tests ALSO remove eagerly in their own finally -
// each case (and each property run) makes its own checkout, and letting a few
// hundred accumulate until the afterEach sweep would be wasteful. The helper
// documents exactly this: it tolerates a path already removed.
const { mkTmpDir } = require('./helpers/tmpDir');

const { readSwarmName, DEFAULT_SWARM_NAME } = require('../out/bridge/holisticProjections');
const { emitFleetStatus, fleetRendezvousDir } = require('../out/tools/emit-fleet-status');

const RUNS = Number(process.env.PROPERTY_RUNS || 240);

// Deterministic generator - no Math.random, so a failure is reproducible from
// its seed alone.
function makeRng(seed) {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return Math.floor(s / 65536) % Math.max(1, n);
  };
}

const NAME_POOL = ['primary', 'second', 'third', 'swarm-x', DEFAULT_SWARM_NAME];

function makeCheckout({ identity, conf }) {
  const root = mkTmpDir('bl1010p-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  if (identity !== null) {
    fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'),
      `swarm_name\t${identity}\nswarm_mode\tautonomous\n`);
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'),
    conf === null ? 'config active_backlog_max_depth 3\n'
                  : `config active_backlog_max_depth 3\nconfig swarm_name ${conf}\n`);
  // The publisher reconstructs this swarm's pack from roles.tsv. The rows
  // are irrelevant to the invariant under test (which name is published, and
  // where) - they only have to exist so the reconstruction runs at all.
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'),
    ['coordinator\tswarmforge-coordinator\t0', 'coder\tswarmforge-coder\t0'].join('\n') + '\n');
  return root;
}

test('BL-1010 invariant 1: the resolution order is identity, then conf, then the shared default', () => {
  const rng = makeRng(1010);
  const coverage = { identityWins: 0, confWins: 0, defaultWins: 0, disagree: 0, agree: 0 };

  for (let i = 0; i < RUNS; i++) {
    const hasIdentity = rng(4) !== 0;   // ~3 in 4
    const hasConf = rng(3) !== 0;       // ~2 in 3
    const identity = hasIdentity ? NAME_POOL[rng(NAME_POOL.length)] : null;
    // DERIVED, not drawn: when both exist, the conf name is built from the
    // identity name so the two are guaranteed to differ. Drawing it
    // independently would silently generate agreement - the exact condition
    // under which the historical defect is invisible.
    const conf = !hasConf ? null
      : (identity === null ? NAME_POOL[rng(NAME_POOL.length)] : `${identity}-conf`);

    const root = makeCheckout({ identity, conf });
    try {
      const resolved = readSwarmName(root);
      const expected = identity !== null ? identity : (conf !== null ? conf : DEFAULT_SWARM_NAME);
      assert.equal(resolved, expected,
        `identity=${identity} conf=${conf}: resolver must prefer identity, then conf, then the default`);

      if (identity !== null) { coverage.identityWins++; if (conf !== null) coverage.disagree++; else coverage.agree++; }
      else if (conf !== null) coverage.confWins++;
      else coverage.defaultWins++;
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  // Reach floors: assertions, not diagnostics. Without the disagreement case
  // the property quantifies over exactly the states in which the historical
  // defect cannot be observed.
  assert.ok(coverage.disagree >= 60, `identity/conf disagreement reached only ${coverage.disagree} times`);
  assert.ok(coverage.identityWins >= 100, `identity-present reached only ${coverage.identityWins} times`);
  assert.ok(coverage.confWins >= 20, `conf-only reached only ${coverage.confWins} times`);
  assert.ok(coverage.defaultWins >= 10, `neither-present reached only ${coverage.defaultWins} times`);
});

test('BL-1010 invariant 2: publishing from a tree named X writes under X and under no other name', () => {
  const rng = makeRng(2010);
  const coverage = { nonDefault: 0, isDefault: 0, confDisagrees: 0 };
  const RUNS_2 = Math.min(RUNS, 40); // each run does real IO through the publisher

  for (let i = 0; i < RUNS_2; i++) {
    const identity = NAME_POOL[rng(NAME_POOL.length)];
    // Again derived: a conf that disagrees is the pre-fix cross-name write.
    const conf = rng(2) === 0 ? `${identity}-conf` : null;
    const root = makeCheckout({ identity, conf });
    const fleetDir = mkTmpDir('bl1010f-');
    try {
      const env = { ...process.env, SWARMFORGE_FLEET_DIR: fleetDir };
      const doc = emitFleetStatus(root, 1_700_000_000_000, env);

      assert.equal(doc.identity.name, identity,
        'the published document must identify the swarm by its identity file');

      // The invariant's real content: nothing was written under ANY other
      // name. Enumerating the directory is what catches a cross-name write;
      // asserting only that X exists would pass while primary/ was clobbered
      // alongside it.
      const written = fs.readdirSync(fleetDir).sort();
      assert.deepEqual(written, [identity],
        `only ${identity} may appear under the rendezvous dir; found ${written.join(', ')}`);
      assert.ok(fs.existsSync(path.join(fleetDir, identity, 'status.json')),
        'the status document itself must be written');

      if (identity === DEFAULT_SWARM_NAME) coverage.isDefault++; else coverage.nonDefault++;
      if (conf !== null) coverage.confDisagrees++;
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(fleetDir, { recursive: true, force: true });
    }
  }

  assert.ok(coverage.nonDefault >= 10, `a non-default swarm name reached only ${coverage.nonDefault} times`);
  assert.ok(coverage.isDefault >= 3, `the default name reached only ${coverage.isDefault} times`);
  assert.ok(coverage.confDisagrees >= 10, `a disagreeing conf reached only ${coverage.confDisagrees} times`);
});

test('BL-1010 invariant 1 (structural): no caller keeps a private resolution order', () => {
  // A property over inputs cannot catch a caller that never calls the
  // resolver. This reads the source instead: every module that answers "what
  // is this swarm called" must import readSwarmName, and none may reach for
  // the conf key itself.
  const srcDir = path.join(__dirname, '..', 'src');
  const callers = ['tools/emit-fleet-status.ts', 'metrics/backlogDashboard.ts', 'bridge/bridgeState.ts'];
  for (const rel of callers) {
    const src = fs.readFileSync(path.join(srcDir, rel), 'utf8');
    assert.ok(/readSwarmName/.test(src), `${rel} must resolve the swarm name through readSwarmName`);
    assert.ok(!/readConfigValue\s*\([^)]*['"]swarm_name['"]/.test(src),
      `${rel} must not read swarm_name from the conf directly - that is a private resolution order`);
    assert.ok(!/swarm-identity/.test(src),
      `${rel} must not read the identity file directly - one resolver, one order`);
  }
});
