'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO = path.join(__dirname, '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'headroom_cap_raise_lib.bb');

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env },
  });
}

test('property (invariant 1): telemetry-path resolves chaser-YYYY-MM.jsonl without throw', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 3 }), () => {
      const root = mkTmpDir('bl1132-tel-');
      const r = runBb(`
(load-file "${LIB}")
(def p (headroom-cap-raise-lib/telemetry-path "${root}"))
(println p)
`);
      assert.equal(r.status, 0, r.stderr || r.stdout);
      assert.match(r.stdout || '', /\.swarmforge\/telemetry\/chaser-\d{4}-\d{2}\.jsonl/);
    }),
    { numRuns: 5 }
  );
});

test('property (invariant 2): under-max sustained samples are not false pressure', () => {
  fc.assert(
    fc.property(fc.double({ min: 0.05, max: 0.5, noNaN: true }), (ratio) => {
      const r = runBb(`
(load-file "${LIB}")
(def ok (headroom-cap-raise-lib/sustained-cpu-headroom?
         [{:ratio ${ratio}} {:ratio ${ratio}} {:ratio ${ratio}} {:ratio ${ratio}}]
         1.0 600000 200000))
(println (str "CPU=" ok))
`);
      assert.equal(r.status, 0, r.stderr || r.stdout);
      assert.match(r.stdout || '', /CPU=true/);
    }),
    { numRuns: 8 }
  );
});

test('property (invariant 3): coordinator prompt names headroom_cap_raise_cli raise', () => {
  const text = fs.readFileSync(path.join(REPO, 'swarmforge', 'roles', 'coordinator.prompt'), 'utf8');
  assert.match(text, /headroom_cap_raise_cli/);
  assert.match(text, /never hand-edit.*active_backlog_max_depth/i);
});
