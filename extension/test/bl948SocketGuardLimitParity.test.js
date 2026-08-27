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

const {
  SOCKET_PATH_GUARD_LIMIT,
  WORST_CASE_SOCKET_SUFFIX,
} = require('../../specs/pipeline/steps/lib/socketFixtureRoot');

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

// BL-948 hardening (hardender): the LIMIT is not the only literal mirrored
// across this boundary. WORST_CASE_SOCKET_SUFFIX mirrors the SHAPE of the
// path swarm_socket_lib.bb actually builds -
// (str working-dir "/.swarmforge/tmux/" hash ".sock") - and the headroom
// assert in mkSocketFixtureRoot is only meaningful if the shape still
// matches. The limit got a gate in the cleaner pass; this half did not, and
// it drifts just as silently: rename the socket directory on the .bb side
// and every fixture would measure headroom for a path the swarm no longer
// builds, while both suites stay green. Same BL-897 rule, same
// read-the-other-side's-literal method as the test above.
//
// The hash is `cksum` output (project_socket_id_lib.sh: CRC32), so its
// widest value is 4294967295 - 10 digits. That is what makes this a WORST
// case rather than a guess, and it is asserted rather than assumed.
test('BL-948/BL-897: the JS worst-case socket suffix matches the shape swarm_socket_lib.bb builds', () => {
  const source = fs.readFileSync(SWARM_SOCKET_LIB, 'utf8');
  const match = /\(str\s+working-dir\s+"([^"]*)"\s+hash\s+"([^"]*)"\)/.exec(source);

  assert.ok(
    match,
    'could not find primary-socket-path\'s (str working-dir "..." hash "...") in '
    + 'swarm_socket_lib.bb - if the socket path is built differently now, this parity gate '
    + 'must be updated to follow it, never deleted'
  );

  const [, dirPart, extPart] = match;
  const MAX_CKSUM = '4294967295'; // CRC32 upper bound, project_socket_id_lib.sh

  assert.equal(
    WORST_CASE_SOCKET_SUFFIX,
    `${dirPart}${MAX_CKSUM}${extPart}`,
    `socketFixtureRoot.js's WORST_CASE_SOCKET_SUFFIX (${WORST_CASE_SOCKET_SUFFIX}) no longer `
    + `matches the path swarm_socket_lib.bb builds (${dirPart}<hash>${extPart}). The .bb shape `
    + 'is the one the swarm actually binds; bring the mirror to it.'
  );
});

test('BL-948: the worst-case hash width is the CRC32 bound project_socket_id_lib.sh can emit', () => {
  const lib = fs.readFileSync(
    path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'project_socket_id_lib.sh'),
    'utf8'
  );
  assert.match(
    lib,
    /cksum/,
    'project_socket_id no longer derives the socket id from cksum, so 4294967295 is no longer '
    + 'its widest value - re-derive WORST_CASE_SOCKET_SUFFIX from whatever produces the id now'
  );
});
