const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { installInProcessTmux } = require('./helpers/fakeTmux');
const { resolveRolePaneTarget } = require('../out/tools/telegram-front-desk-bot');

// BL-846 invariant 1 (coder.prompt's Invariants section - first authorship
// rests with the coder): "An answer is never injected into a pane running a
// different role than the one it is addressed to: the resident pane is
// resolved for role R only while the durable resident-identity marker names
// R, and for no other role or marker state."
//
// Drives the REAL compiled resolveRolePaneTarget against a randomly
// generated roster (sessions.tsv), a randomly chosen requested role, and a
// randomly chosen marker state (matches the requested role, names a
// DIFFERENT roster role, names a role absent from the roster entirely,
// missing file, or blank file) - proving the redirect fires in EXACTLY the
// one case the invariant names, never the others, across many random
// rosters rather than the ticket's own handful of hand-picked examples.
//
// Generator-reach note (coder.prompt's Invariants section): the roster
// generator always places 'coordinator' at a random index among 2-6 DISTINCT
// non-coordinator roles, so both "coordinator first" and "coordinator last"
// roster orderings - and every requested-role/marker-kind combination - are
// reachable, not just the common "coordinator last" shape real sessions.tsv
// files use.
//
// Non-vacuity, checked by hand before landing: temporarily changing the
// production condition from `role !== 'coordinator' && activeRole === role`
// to `true` (always redirect to the resident) reproduced the exact failure
// this property is built to catch - the 'other-in-roster' and
// 'other-not-in-roster' cases resolved to the resident pane instead of the
// requested role's own session/undefined; restoring the real condition made
// it pass again.

const NON_COORD_ROLE_POOL = ['coder', 'QA', 'cleaner', 'architect', 'hardener', 'documenter', 'specifier'];

const rosterRolesArb = fc
  .uniqueArray(fc.constantFrom(...NON_COORD_ROLE_POOL), { minLength: 2, maxLength: NON_COORD_ROLE_POOL.length })
  .chain((nonCoordRoles) =>
    fc.integer({ min: 0, max: nonCoordRoles.length }).map((coordinatorIndex) => {
      const roster = [...nonCoordRoles];
      roster.splice(coordinatorIndex, 0, 'coordinator');
      return roster;
    })
  );

const scenarioArb = rosterRolesArb.chain((roster) =>
  fc.record({
    roster: fc.constant(roster),
    requestedRole: fc.constantFrom(...roster),
    markerKind: fc.constantFrom('matches', 'other-in-roster', 'other-not-in-roster', 'missing', 'blank'),
  })
);

function mkRoot() {
  return mkTmpDir('sfvc-bl846-prop-');
}

function writeSessionsFixture(root, roster) {
  const stateDir = path.join(root, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  const lines = roster.map((role, i) => `${i + 1}\t${role}\tswarmforge-${role}\t${role}\tclaude`).join('\n');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), `${lines}\n`);
}

function writeMarker(root, markerKind, requestedRole, roster) {
  const markerPath = path.join(root, '.swarmforge', 'mono-router-active-role');
  if (markerKind === 'missing') {
    return;
  }
  if (markerKind === 'blank') {
    fs.writeFileSync(markerPath, '   \n');
    return;
  }
  if (markerKind === 'matches') {
    fs.writeFileSync(markerPath, `${requestedRole}\n`);
    return;
  }
  if (markerKind === 'other-not-in-roster') {
    fs.writeFileSync(markerPath, 'a-role-nobody-has\n');
    return;
  }
  // other-in-roster: any roster role distinct from requestedRole.
  const other = roster.find((r) => r !== requestedRole) ?? 'a-role-nobody-has';
  fs.writeFileSync(markerPath, `${other}\n`);
}

// The SAME model resolveMonoRouterAwareRoleEntry (telegram-front-desk-bot.ts)
// implements: expected role entry's session, given roster/requested/marker.
function expectedSession(roster, requestedRole, markerKind) {
  const redirects = markerKind === 'matches' && requestedRole !== 'coordinator';
  if (redirects) {
    const resident = roster.find((r) => r !== 'coordinator');
    return resident ? `swarmforge-${resident}` : undefined;
  }
  return roster.includes(requestedRole) ? `swarmforge-${requestedRole}` : undefined;
}

test('property: the resident pane is resolved for role R only while the marker names R, and for no other role or marker state', () => {
  fc.assert(
    fc.property(scenarioArb, ({ roster, requestedRole, markerKind }) => {
      const root = mkRoot();
      writeSessionsFixture(root, roster);
      writeMarker(root, markerKind, requestedRole, roster);
      const fake = installInProcessTmux([{ subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' }]);
      try {
        const resolved = resolveRolePaneTarget(root, requestedRole);
        const expected = expectedSession(roster, requestedRole, markerKind);
        if (expected === undefined) {
          assert.equal(resolved, undefined, `expected no pane resolved for role "${requestedRole}" in roster ${JSON.stringify(roster)}`);
        } else {
          assert.ok(resolved, `expected a resolved pane for role "${requestedRole}" in roster ${JSON.stringify(roster)}`);
          assert.equal(
            resolved.target.split(':')[0],
            expected,
            `roster=${JSON.stringify(roster)} requestedRole=${requestedRole} markerKind=${markerKind}: expected session "${expected}", got "${resolved.target}"`
          );
        }
      } finally {
        fake.restore();
      }
    }),
    { numRuns: 60 }
  );
});
