'use strict';

// BL-1719's one declared invariant: "Outside a rotation-router pack, a
// wake is typed only into the session roles.tsv names for the parcel's
// recipient; a recipient with no session gets no wake, on every delivery
// path."
//
// resolve-wake-session (handoff_lib.bb) is the pure core both delivery
// paths (handoffd.bb's notify!, handoff_inject_lib.bb's deliver-parcel!)
// call - exhaustively enumerated here, never fc-sampled (this session's
// own precedent for a state space this small).

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'handoff_lib.bb');

function bbEval(expr) {
  const out = execFileSync('bb', ['-e', `(load-file "${LIB}") ${expr}`], { encoding: 'utf8' });
  return out.trim();
}

function resolveWakeSession({ configuredExists, residentSession, residentExists, rotationRouterPack }) {
  const residentForm = residentSession === null ? 'nil' : `"${residentSession}"`;
  const edn =
    `{:configured-session "swarmforge-coder@2"` +
    ` :configured-exists? ${configuredExists}` +
    ` :resident-session ${residentForm}` +
    ` :resident-exists? ${residentExists}` +
    ` :rotation-router-pack? ${rotationRouterPack}}`;
  return bbEval(`(println (or (handoff-lib/resolve-wake-session ${edn}) "nil"))`);
}

const BOOLS = [true, false];
const RESIDENTS = [{ session: 'swarmforge-specifier', label: 'present' }, { session: null, label: 'absent' }];

test('invariant, first half: the configured session is used whenever it exists, in every pack shape (never redirected while it stands)', () => {
  const reach = new Set();
  for (const residentExists of BOOLS) {
    for (const { session: residentSession, label } of RESIDENTS) {
      for (const rotationRouterPack of BOOLS) {
        reach.add(`${residentExists}:${label}:${rotationRouterPack}`);
        const raw = resolveWakeSession({
          configuredExists: true,
          residentSession,
          residentExists,
          rotationRouterPack,
        });
        assert.equal(
          raw,
          'swarmforge-coder@2',
          `expected the configured session unchanged for ${JSON.stringify({ residentExists, residentSession, rotationRouterPack })}, got: ${raw}`
        );
      }
    }
  }
  assert.equal(reach.size, 2 * 2 * 2, 'reach floor: expected every combination to be constructed');
});

test('invariant, second half: outside a rotation-router pack, a recipient with no session gets no wake (nil) - regardless of whether a resident stands', () => {
  const reach = new Set();
  for (const residentExists of BOOLS) {
    for (const { session: residentSession, label } of RESIDENTS) {
      reach.add(`${residentExists}:${label}`);
      const raw = resolveWakeSession({
        configuredExists: false,
        residentSession,
        residentExists,
        rotationRouterPack: false,
      });
      assert.equal(
        raw,
        'nil',
        `expected nil (no wake) outside a rotation-router pack for ${JSON.stringify({ residentExists, residentSession })}, got: ${raw}`
      );
    }
  }
  assert.equal(reach.size, 2 * 2, 'reach floor: expected every combination to be constructed');
});

test('inside a rotation-router pack, the pre-BL-1719 remap is unchanged: a missing session remaps to a live resident, or keeps the configured name when nothing stands', () => {
  const remapped = resolveWakeSession({
    configuredExists: false,
    residentSession: 'swarmforge-specifier',
    residentExists: true,
    rotationRouterPack: true,
  });
  assert.equal(remapped, 'swarmforge-specifier', `expected the remap to the live resident, got: ${remapped}`);

  const fallback = resolveWakeSession({
    configuredExists: false,
    residentSession: null,
    residentExists: false,
    rotationRouterPack: true,
  });
  assert.equal(fallback, 'swarmforge-coder@2', `expected the configured name kept when nothing stands, got: ${fallback}`);
});

// The remap branch's own guard is `(and (not (str/blank? resident-session))
// resident-exists?)` - an AND of two independent conjuncts. Both cases
// above agree on both conjuncts at once (present+alive, or absent+dead),
// so neither can tell the AND from either conjunct alone. Confirmed by
// hand-mutation during this hardening pass: dropping resident-exists?
// (keeping only the non-blank check) survived every existing test here
// AND the acceptance feature's own scenario 02 (whose fixture resident is
// always alive) - a resident NAMED but not itself alive would then be
// remapped to, producing exactly the "wake typed into a dead session"
// defect this ticket exists to prevent. This is the disagreeing case: a
// resident session is named in roles.tsv, but that session does not
// itself exist right now (e.g. the resident's own pane crashed).
test('inside a rotation-router pack, a resident NAMED but not itself alive is never remapped to - only a resident session that both is present and exists', () => {
  const namedButDead = resolveWakeSession({
    configuredExists: false,
    residentSession: 'swarmforge-specifier',
    residentExists: false,
    rotationRouterPack: true,
  });
  assert.equal(
    namedButDead,
    'swarmforge-coder@2',
    `expected the configured name kept (never the dead resident's name) when the resident session is named but not alive, got: ${namedButDead}`
  );
});
