'use strict';

// BL-1345's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  The resident marker is read only where it applies: on a pack
//                that does not declare rotation router, no code path derives a
//                resident role, a resident mailbox state or a dispatch-note
//                state from it.
//   invariant 2  A pane running a role other than the one its pack assigns it
//                is never reported healthy by any recheck, however the
//                mismatch arose.
//   invariant 3  An absent, unreadable or unknown-role marker yields the same
//                conclusions as no marker at all - never a defaulted role.
//
// All three drive the REAL decisions - mono_router_lib's resolve-resident-role
// and remote_control_health_lib's assigned-role-mismatch - composed exactly as
// babysitter_check.bb and swarm_ensure.bb compose them.
//
// GENERATOR REACH (by construction). Pack topology and marker state are the
// axes, so both are ENUMERATED by the enclosing loops; only which role a
// usable marker names is generated. Every combination therefore runs in every
// pass.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const MONO_ROUTER_LIB = path.join(SCRIPTS, 'mono_router_lib.bb');
const RC_HEALTH_LIB = path.join(SCRIPTS, 'remote_control_health_lib.bb');
const SWEEP_SRC = path.join(SCRIPTS, 'babysitter_check.bb');
const ROLES = ['specifier', 'coder', 'cleaner', 'hardender', 'QA'];
const HOME = 'specifier';

function bb(expression, lib) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${lib}")
(println (json/generate-string ${expression}))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// Exactly the composition babysitter_check.bb performs.
function sweepResident(rotationRouter, marker) {
  const decision = bb(
    `(mono-router-lib/resolve-resident-role
       {:rotation-router? ${rotationRouter ? 'true' : 'false'}
        :recorded-role ${marker === null ? 'nil' : JSON.stringify(marker)}
        :home-role "${HOME}"})`,
    MONO_ROUTER_LIB,
  );
  const candidate = decision['honour-marker?'] ? decision.role : null;
  return ROLES.includes(candidate) ? candidate : null;
}

test('BL-1345/BL-654 invariant 1: a standing pack derives nothing from the marker', () => {
  const reach = { usable: 0, unusable: 0 };

  // The three states that make a marker unusable, plus a usable one naming a
  // real role: all enumerated, so the corner that matters (a leftover marker
  // naming a REAL role on a standing pack - the outage shape) runs every time.
  for (const marker of [null, '   ', 'nosuchrole', 'coordinator']) {
    fc.assert(
      fc.property(fc.constantFrom(...ROLES), (namedRole) => {
        const value = marker === 'coordinator' ? namedRole : marker;
        if (value && ROLES.includes(value)) reach.usable += 1;
        else reach.unusable += 1;

        assert.equal(
          sweepResident(false, value),
          null,
          `a standing pack derived a resident from marker ${JSON.stringify(value)}`,
        );
        return true;
      }),
      { numRuns: 3 },
    );
  }

  assert.ok(reach.usable > 0, 'never exercised a marker naming a real role - the outage shape went untested');
  assert.ok(reach.unusable > 0, 'never exercised an unusable marker');

  // The structural half: the sweep must route through the shared decision.
  // The whole defect was a third consumer that never got the rule, so a copy
  // of the mode check living here again would pass every case above.
  const source = fs.readFileSync(SWEEP_SRC, 'utf8');
  assert.match(source, /resolve-resident-role/, 'the sweep no longer uses the shared decision');
});

test('BL-1345/BL-654 invariant 3: the router pack still resolves, and unusable markers never default', () => {
  for (const marker of [null, '   ', 'nosuchrole']) {
    fc.assert(
      fc.property(fc.constantFrom(true, false), (rotationRouter) => {
        // Never a defaulted role - not the home role, not anything.
        assert.equal(
          sweepResident(rotationRouter, marker),
          null,
          `an unusable marker ${JSON.stringify(marker)} produced a resident`,
        );
        return true;
      }),
      { numRuns: 2 },
    );
  }

  // And the regression guard the ticket calls the case that matters most: a
  // fix that made the marker inert everywhere would have broken BL-1020/BL-648.
  fc.assert(
    fc.property(fc.constantFrom(...ROLES), (role) => {
      assert.equal(sweepResident(true, role), role, 'a router pack lost its resident');
      return true;
    }),
    { numRuns: 5 },
  );
});

test('BL-1345/BL-654 invariant 2: a wrong-role pane is never healthy, and a right-role pane never cries wolf', () => {
  const reach = { mismatch: 0, match: 0, router: 0 };

  // GENERATOR REACH (by construction, not by luck): each arm is an enclosing
  // CASE, and the mismatching arm DERIVES its observed role from the assigned
  // one rather than drawing it independently. Two independent draws over 5
  // roles matched only 1 time in 5, so `reach.match` stayed 0 in about 7% of
  // 12-run passes and red the suite on nothing (architect bounce D1,
  // 2026-09-03) - the same defect shape BL-1352's own D1 fixed one ticket
  // earlier. A floor that bites spuriously is the mirror image of a vacuous
  // one: it teaches the reader to re-run a red rather than read it.
  const CASES = [
    { rotationRouter: true, sameRole: true },
    { rotationRouter: true, sameRole: false },
    { rotationRouter: false, sameRole: true },
    { rotationRouter: false, sameRole: false },
  ];

  for (const { rotationRouter, sameRole } of CASES) {
    fc.assert(
      fc.property(
        fc.constantFrom(...ROLES),
        // 1..n-1, so the mismatching arm can never land back on `assigned`.
        fc.integer({ min: 1, max: ROLES.length - 1 }),
        (assigned, offset) => {
          const observed = sameRole ? assigned : ROLES[(ROLES.indexOf(assigned) + offset) % ROLES.length];
          const result = bb(
            `(remote-control-health/assigned-role-mismatch
               {:rotation-router? ${rotationRouter ? 'true' : 'false'}
                :pane "swarmforge-${assigned}"
                :assigned-rc-name "SwarmForge-${assigned}"
                :observed-rc-name "SwarmForge-${observed}"})`,
            RC_HEALTH_LIB,
          );

          if (rotationRouter) {
            reach.router += 1;
            // A rotated resident legitimately runs another role's script.
            assert.equal(result, null, 'a router pack reported a rotation as a mismatch');
            return true;
          }
          if (sameRole) {
            reach.match += 1;
            assert.equal(result, null, 'a correctly staffed pane was flagged - a check that cries wolf is worse');
          } else {
            reach.mismatch += 1;
            assert.notEqual(result, null, `a pane running ${observed} in ${assigned}'s slot was not flagged`);
            // Naming all three is the point: a mismatch that does not say what
            // it saw sends the reader back to the pane to find out.
            assert.equal(result.pane, `swarmforge-${assigned}`);
            assert.equal(result.expected, `SwarmForge-${assigned}`);
            assert.equal(result.observed, `SwarmForge-${observed}`);
          }
          return true;
        },
      ),
      { numRuns: 6 },
    );
  }

  assert.ok(reach.mismatch > 0, 'never exercised a mismatched pane');
  assert.ok(reach.match > 0, 'never exercised a correctly staffed pane');
  assert.ok(reach.router > 0, 'never exercised a rotation-router pack');
});
