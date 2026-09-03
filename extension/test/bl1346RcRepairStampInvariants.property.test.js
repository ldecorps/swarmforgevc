'use strict';

// BL-1346's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  The hotfix removed a wrong respawn, never the ability to
//                respawn: a genuinely down pane is still repaired, and with
//                the role its pack assigns it.
//   invariant 2  The marker retains its full authority on a rotation-router
//                pack; only its application to a non-router pack was removed.
//   invariant 3  This stamp-off never reimplements, rewrites or reverts
//                195de28861 - it confirms or refutes what landed.
//
// Invariants 1 and 2 are properties of the LANDED code and drive the real
// swarm_ensure.bb (real roles.tsv, real launch scripts, a fake tmux that
// records respawns instead of performing them) and the real shared BL-1020
// decision. Invariant 3 quantifies over THIS PARCEL rather than a pure
// function, so it is a property of the working tree and is checked against it
// directly - the alternative is not encoding it at all, and a declared
// invariant is never silently unencoded.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  REPO_ROOT,
  ROLES,
  makeFixture,
  removeFixture,
  runEnsure,
  callSharedDecision,
} = require('../../specs/pipeline/steps/lib/bl1346RcRepairStampFixture');

const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');
const REVIEWED_COMMIT = '195de28861';

// The files the hotfix landed in. A stamp-off that edited any of them would
// be reimplementing what it is meant only to review.
const REVIEWED_SOURCES = [
  'swarmforge/scripts/swarm_ensure.bb',
  'swarmforge/scripts/mono_router_lib.bb',
  'swarmforge/scripts/test/test_swarm_ensure.sh',
];

function otherRole(role) {
  return ROLES.find((r) => r !== role);
}

test('BL-1346/BL-654 invariant 1: a degraded pane is still repaired, with its own pack role', () => {
  // GENERATOR REACH (by construction): every pane the pack staffs gets its
  // own case, including the FIRST roles.tsv row - the one the pre-hotfix
  // code misclassified as the mono-router resident, and the only one the
  // defect could ever reach. Drawing the degraded role from a pool would let
  // a pass happen without ever touching it.
  const reach = Object.fromEntries(ROLES.map((r) => [r, 0]));

  for (const degraded of ROLES) {
    fc.assert(
      fc.property(fc.constantFrom(otherRole(degraded), null), (marker) => {
        reach[degraded] += 1;
        const fx = makeFixture({ rotation: '', marker, staffing: { [degraded]: 'degraded' } });
        try {
          const run = runEnsure(fx);
          const respawns = run.respawns.trim();
          assert.ok(respawns.length > 0, `a degraded ${degraded} pane was left unrepaired - the repair stopped repairing`);
          assert.match(
            respawns,
            new RegExp(`respawn-pane -k -t swarmforge-${degraded}`),
            `the repair respawned the wrong pane: ${respawns}`,
          );
          assert.match(
            respawns,
            new RegExp(`launch/${degraded}\\.sh`),
            `the pane was not repaired with the role its pack assigns it: ${respawns}`,
          );
          if (marker) {
            assert.ok(
              !respawns.includes(`launch/${marker}.sh`),
              `a stale marker's role was respawned into ${degraded}'s pane: ${respawns}`,
            );
          }
          // And no OTHER pane was disturbed while repairing this one.
          for (const other of ROLES.filter((r) => r !== degraded)) {
            assert.ok(
              !respawns.includes(`swarmforge-${other}`),
              `a correctly-staffed ${other} pane was respawned: ${respawns}`,
            );
          }
          return true;
        } finally {
          removeFixture(fx);
        }
      }),
      { numRuns: 1 },
    );
  }

  for (const [role, count] of Object.entries(reach)) {
    assert.ok(count > 0, `never exercised a degraded ${role} pane`);
  }
}, 120000);

test('BL-1346/BL-654 invariant 2: the marker keeps full authority on a router pack, and none off it', () => {
  // Both halves of the same claim, over every marker value the packs can
  // carry: on a rotation-router pack the marker names the resident's role;
  // on a standing pack it names nothing. The pair is derived - the standing
  // case uses the SAME marker as the router case - so the two answers are
  // compared on identical input rather than on two independent draws.
  const reach = { router: 0, standing: 0 };
  const home = ROLES[0];

  fc.assert(
    fc.property(fc.constantFrom(...ROLES.filter((r) => r !== home)), (marker) => {
      reach.router += 1;
      reach.standing += 1;
      const [standing, router] = callSharedDecision(
        `(emit (mono-router-lib/resolve-resident-role
                 {:rotation-router? false :recorded-role "${marker}" :home-role "${home}"}))
         (emit (mono-router-lib/resolve-resident-role
                 {:rotation-router? true :recorded-role "${marker}" :home-role "${home}"}))`,
      );
      assert.equal(router.role, marker, `the marker lost its authority on a router pack: ${JSON.stringify(router)}`);
      assert.equal(router['honour-marker?'], true, 'the router pack no longer honours the marker');
      assert.equal(standing.role, home, `a standing pane was renamed by the marker: ${JSON.stringify(standing)}`);
      assert.equal(standing['honour-marker?'], false, 'the standing pack honours the marker again');
      return true;
    }),
    { numRuns: 2 },
  );

  // ...and the same distinction, end to end, through the real ensure run:
  // one marker, two packs, opposite repairs.
  const marker = ROLES.find((r) => r !== home);
  for (const [rotation, expected] of [['router', marker], ['', home]]) {
    const fx = makeFixture({ rotation, marker, staffing: { [home]: 'degraded' } });
    try {
      const respawns = runEnsure(fx).respawns.trim();
      assert.match(
        respawns,
        new RegExp(`launch/${expected}\\.sh`),
        `on a "${rotation || 'standing'}" pack the resident was repaired with the wrong role: ${respawns}`,
      );
    } finally {
      removeFixture(fx);
    }
  }

  assert.ok(reach.router > 0 && reach.standing > 0, 'never exercised both pack shapes');
}, 120000);

test('BL-1346/BL-654 invariant 3: the stamp-off parcel never edits the code it reviews', () => {
  // Measured, not asserted in prose, and scoped to THIS PARCEL's own commits
  // - a branch-wide diff would go red the moment an unrelated later ticket
  // touched swarm_ensure.bb.
  const commits = execFileSync('git', ['log', '--format=%H', '--grep', 'BL-1346', 'origin/main..HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  // No BL-1346 commit in range means the parcel has landed and the question
  // is settled elsewhere - not that it edited something.
  if (commits.length > 0) {
    const changed = commits
      .flatMap((sha) =>
        execFileSync('git', ['show', '--first-parent', '--name-only', '--format=', sha], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
        })
          .split('\n')
          .filter(Boolean),
      )
      .filter((v, i, a) => a.indexOf(v) === i);
    for (const reviewed of REVIEWED_SOURCES) {
      assert.ok(!changed.includes(reviewed), `the stamp-off parcel edits ${reviewed}, which it is meant only to review`);
    }
  }

  // And the review is inert on the ledger: no green suite writes a decision
  // only a human may write (BL-848).
  const ledger = fs.readFileSync(LEDGER, 'utf8');
  const start = ledger.indexOf(`- commit: ${REVIEWED_COMMIT}`);
  assert.ok(start >= 0, `no ledger row for ${REVIEWED_COMMIT}`);
  const rest = ledger.slice(start + 1);
  const end = rest.indexOf('\n- commit:');
  const row = end === -1 ? rest : rest.slice(0, end);
  assert.doesNotMatch(row, /state:\s*(certified|waived)\b/, `a decided state appears on the row:\n${row}`);
  assert.match(row, /human_decision: null/, `a decision was written without a human:\n${row}`);
  assert.match(row, /decided_at: null/, `a decision timestamp was written without a human:\n${row}`);
});
