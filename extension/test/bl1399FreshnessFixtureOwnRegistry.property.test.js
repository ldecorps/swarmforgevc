'use strict';

// BL-1399 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   1. The fixture's conf and its required registry always agree and are both
//      the fixture's own: every daemon the fixture's registry names has a row
//      in the fixture's conf, and neither file is read from the live scripts
//      directory.
//   2. The fail-closed registry guard is untouched: with the live required
//      list and a conf missing a listed daemon it still refuses naming the
//      daemon (BL-784).
//
// GENERATOR REACH, constructed: invariant 1 draws its registry as a SUBSET of
// the daemons the fixture conf actually carries, so every case is a genuine
// agreement rather than one the generator has to stumble onto; invariant 2
// draws the missing daemon FROM the live required list, filtered to those the
// fixture conf lacks, so every case is a genuine "required but absent".

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GUARD = path.join(SCRIPTS, 'daemon_log_freshness_registry_guard.sh');
const LIVE_REQUIRED = path.join(SCRIPTS, 'daemon_log_freshness_required.conf');
const NOW = 1700000000;

function liveRequiredNames() {
  return fs
    .readFileSync(LIVE_REQUIRED, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

// The supervisors the guard's second arm walks - derived from the same glob it
// walks, never listed here (BL-1398's lesson).
function supervisorNames() {
  return fs
    .readdirSync(SCRIPTS)
    .filter((f) => f.endsWith('_supervisor.bb'))
    .map((f) => f.slice(0, -'.bb'.length))
    .sort();
}

// The fixture as the property test builds it: its own conf, its own registry.
function makeFixture(root, requiredNames) {
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  const iso = new Date(NOW * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const rows = ['handoffd|120|.swarmforge/daemon/handoffd.log|.swarmforge/daemon/handoffd.pid|start_handoff_daemon.sh'];
  for (const name of supervisorNames()) {
    rows.push(`${name}|600|.swarmforge/daemon/${name}.log|.swarmforge/daemon/${name}.pid|noop.sh`);
    fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', `${name}.log`), `${iso} heartbeat\n`);
  }
  fs.writeFileSync(path.join(root, 'freshness.conf'), `${rows.join('\n')}\n`);
  fs.writeFileSync(path.join(root, 'freshness_required.conf'), `${requiredNames.join('\n')}\n`);
  return {
    conf: path.join(root, 'freshness.conf'),
    required: path.join(root, 'freshness_required.conf'),
    daemons: rows.map((r) => r.split('|')[0]),
  };
}

function runGuard({ conf, required }) {
  const r = spawnSync('/bin/sh', [GUARD], {
    encoding: 'utf8',
    env: { ...process.env, FRESHNESS_CONF: conf, FRESHNESS_REQUIRED: required },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function withRoot(fn) {
  const root = mkTmpDir('sfvc-bl1399-prop-');
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('BL-1399 declared invariants', () => {
  it('inv1: the fixture conf and registry agree, and neither is the live file', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat({ max: 64 }), (pick, size) => {
        withRoot((root) => {
          const all = makeFixture(root, ['handoffd']).daemons;
          // Constructed: the registry is a non-empty SUBSET of the daemons the
          // conf carries, so agreement is by construction, not by luck.
          const count = 1 + (size % all.length);
          const start = pick % all.length;
          const chosen = Array.from({ length: count }, (_, i) => all[(start + i) % all.length]);
          const fixture = makeFixture(root, chosen);

          // Both files are the fixture's own - not the live scripts directory.
          assert.ok(!path.resolve(fixture.conf).startsWith(SCRIPTS + path.sep));
          assert.ok(!path.resolve(fixture.required).startsWith(SCRIPTS + path.sep));

          // Every name the registry carries has a row in the conf...
          const confNames = fs
            .readFileSync(fixture.conf, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => l.split('|')[0]);
          for (const name of chosen) {
            assert.ok(confNames.includes(name), `${name} is required but has no conf row`);
          }
          // ...and the guard, which is the thing that actually decides, agrees.
          const { code, out } = runGuard(fixture);
          assert.equal(code, 0, `the guard refused a self-consistent fixture:\n${out}`);
        });
      }),
      { numRuns: 20 },
    );
  }, 120000);

  it('inv2: with the live required list, a conf missing a listed daemon still refuses naming it', () => {
    // Constructed from the live list rather than from a name written here, so
    // this keeps testing the real thing as that list grows.
    const missing = withRoot((root) => {
      const { daemons } = makeFixture(root, ['handoffd']);
      return liveRequiredNames().filter((n) => !daemons.includes(n));
    });
    assert.ok(
      missing.length > 0,
      'the live required list names nothing the fixture conf lacks, so this property proves nothing',
    );

    fc.assert(
      fc.property(fc.nat(), (pick) => {
        const target = missing[pick % missing.length];
        withRoot((root) => {
          const fixture = makeFixture(root, ['handoffd']);
          const { code, out } = runGuard({ conf: fixture.conf, required: LIVE_REQUIRED });
          assert.notEqual(code, 0, `the guard must still refuse the live list:\n${out}`);
          assert.match(out, /FRESHNESS_REGISTRY_GUARD/);
          // It names A missing daemon; the drawn one proves the set is real.
          assert.ok(
            missing.some((n) => out.includes(n)),
            `the refusal named none of the missing daemons (drew ${target}):\n${out}`,
          );
        });
      }),
      { numRuns: 10 },
    );
  }, 120000);
});
