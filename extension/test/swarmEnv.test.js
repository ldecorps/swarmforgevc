const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { loadSwarmEnvFile, parseSwarmEnvExportLine, readSwarmEnvValue } = require('../out/tools/swarmEnv');

test('parseSwarmEnvExportLine parses quoted export lines', () => {
  assert.deepEqual(parseSwarmEnvExportLine('export CURSOR_API_KEY="abc"'), {
    key: 'CURSOR_API_KEY',
    value: 'abc',
  });
  assert.equal(parseSwarmEnvExportLine('# comment'), undefined);
});

test('readSwarmEnvValue loads CURSOR_API_KEY from swarm.env', () => {
  const root = mkTmpDir('sfvc-swarm-env-');
  const envPath = path.join(root, '.swarmforge', 'swarm.env');
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, "export CURSOR_API_KEY='from-file'\nexport FOO=bar\n", 'utf8');
  assert.equal(readSwarmEnvValue(root, 'CURSOR_API_KEY'), 'from-file');
  assert.deepEqual(loadSwarmEnvFile(root), { CURSOR_API_KEY: 'from-file', FOO: 'bar' });
});
