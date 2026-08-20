// BL-948 (cleaner pass): SOCKET_PATH_GUARD_LIMIT in socketFixtureRoot.js is a
// hand-mirror of `max-safe-socket-path-len` in swarm_socket_lib.bb - two
// literals for one bound, on opposite sides of a language boundary no import
// can bridge. The engineering rules require a TEST asserting both agree
// (BL-897): a "kept in sync" comment is not a gate, and drift here fails
// SILENTLY in the worst way - the fixtures would compute headroom against a
// bound the guard no longer enforces, and the scenarios this helper exists to
// rescue would start dying on the guard's refusal again, which is the exact
// three-time recurrence BL-948 was minted to end.
//
// Deliberately parses the .bb source rather than importing it: Babashka is
// not loadable from Node, and the point is to read the OTHER side's own
// literal, not a second copy of our own.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SOCKET_PATH_GUARD_LIMIT } = require('../../specs/pipeline/steps/lib/socketFixtureRoot');

const SWARM_SOCKET_LIB = path.join(
  __dirname, '..', '..', 'swarmforge', 'scripts', 'swarm_socket_lib.bb'
);

test('BL-948/BL-897: the JS fixture guard limit equals swarm_socket_lib.bb\'s own literal', () => {
  const source = fs.readFileSync(SWARM_SOCKET_LIB, 'utf8');
  const match = /\(def\s+max-safe-socket-path-len\s+(\d+)\)/.exec(source);

  assert.ok(
    match,
    'could not find (def max-safe-socket-path-len N) in swarm_socket_lib.bb - if it was renamed, '
    + 'this parity gate must be updated to follow it, never deleted'
  );

  assert.equal(
    SOCKET_PATH_GUARD_LIMIT,
    Number(match[1]),
    `socketFixtureRoot.js's SOCKET_PATH_GUARD_LIMIT (${SOCKET_PATH_GUARD_LIMIT}) has drifted from `
    + `swarm_socket_lib.bb's max-safe-socket-path-len (${match[1]}). The .bb value is the one the `
    + 'swarm actually enforces; bring the mirror to it.'
  );
});
