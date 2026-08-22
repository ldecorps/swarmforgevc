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

// BL-1010. Two readers answered "what is this swarm called" and disagreed:
// swarm_identity_lib.bb reads .swarmforge/swarm-identity (the file the
// launcher actually writes), while the TypeScript readSwarmName read
// swarmforge/swarmforge.conf and nothing else. On the Mac primary they agree
// by coincidence - its conf carries no swarm_name AND its identity file says
// primary - and that coincidence is what kept this invisible. On a secondary
// whose identity says "second", the emit would have published that tree's
// health under "primary" and overwritten the primary's own document.

// Each case builds a real checkout skeleton: the resolver's whole job is
// reading two specific files off disk, so stubbing the reads would test
// nothing that failed.
function checkout({ identity, conf }) {
  const root = mkTmpDir('bl1010-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  if (identity !== undefined) {
    // Tab-separated key/value, exactly as swarmforge.sh's
    // write_swarm_identity_file writes it.
    fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'),
      `swarm_name\t${identity}\nswarm_mode\tautonomous\n`);
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'),
    conf === undefined ? 'config active_backlog_max_depth 3\n'
                       : `config active_backlog_max_depth 3\nconfig swarm_name ${conf}\n`);
  return root;
}

function withCheckout(spec, fn) {
  const root = checkout(spec);
  try {
    return fn(root);
  } finally {
    // Removed in a finally, never only after the last assertion - a throw
    // would otherwise leak the fixture dir forever.
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('BL-1010: the identity file names the swarm when the conf is silent', () => {
  withCheckout({ identity: 'second', conf: undefined }, (root) => {
    assert.equal(readSwarmName(root), 'second');
  });
});

test('BL-1010: the identity file WINS over a conf that says otherwise', () => {
  // The live failure shape inverted: previously the conf (or its absence)
  // decided, and the identity file was never consulted at all.
  withCheckout({ identity: 'second', conf: 'primary' }, (root) => {
    assert.equal(readSwarmName(root), 'second');
  });
});

test('BL-1010: with no identity file the conf still decides (order, not replacement)', () => {
  withCheckout({ identity: undefined, conf: 'third' }, (root) => {
    assert.equal(readSwarmName(root), 'third');
  });
});

test('BL-1010: with neither, the shared default applies', () => {
  withCheckout({ identity: undefined, conf: undefined }, (root) => {
    assert.equal(readSwarmName(root), DEFAULT_SWARM_NAME);
    assert.equal(readSwarmName(root), 'primary');
  });
});

test('BL-1010: an identity file with no swarm_name key falls through to the conf, not to the default', () => {
  const root = mkTmpDir('bl1010-');
  try {
    fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
    fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'), 'swarm_mode\tautonomous\n');
    fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config swarm_name third\n');
    assert.equal(readSwarmName(root), 'third');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BL-1010: an unreadable identity file does not crash the resolver - it falls through', () => {
  // A directory where the file should be: readFileSync throws EISDIR. The
  // resolver must degrade to the next source rather than take the publisher
  // down, matching readConfigValue's own try/catch contract.
  const root = mkTmpDir('bl1010-');
  try {
    fs.mkdirSync(path.join(root, '.swarmforge', 'swarm-identity'), { recursive: true });
    fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config swarm_name third\n');
    assert.equal(readSwarmName(root), 'third');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── the cross-language constant (scenario 03) ─────────────────────────────
// No import can bridge TypeScript and Babashka, so the shared default is
// hand-mirrored. A "kept in sync" comment is not a gate and drift there fails
// silently - this reads BOTH literals from source and compares them.
test('BL-1010: the TypeScript and Babashka default swarm names are the same literal', () => {
  const bb = fs.readFileSync(
    path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'swarm_identity_lib.bb'), 'utf8');
  const m = bb.match(/\(def default-swarm-name\s+"([^"]+)"\)/);
  assert.ok(m, 'swarm_identity_lib.bb must still declare default-swarm-name as a literal');
  assert.equal(DEFAULT_SWARM_NAME, m[1],
    'the two languages disagree on the default swarm name - drift here is silent and mis-publishes fleet status');
});
