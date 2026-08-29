'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'outage_failover_cli.bb');
const HARNESS = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_outage_failover_cli_load_file_safe.bb'
);

test('BL-1150: source guards -main behind babashka.file (no bare (-main))', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.match(src, /babashka\.file/);
  assert.doesNotMatch(src, /^\(-main\)$/m);
});

test('BL-1150: load-file harness exits 0 without invoking usage', () => {
  const res = spawnSync('bb', [HARNESS], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.match(`${res.stdout}${res.stderr}`, /PASS: load-file/);
  assert.doesNotMatch(`${res.stdout}${res.stderr}`, /Usage:\s*outage_failover_cli/);
});

test('BL-1150: bb entrypoint with no command still reaches usage via -main', () => {
  const res = spawnSync('bb', [CLI], { encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}${res.stderr}`, /Usage:\s*outage_failover_cli/);
});
