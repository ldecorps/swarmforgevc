const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readRoleConfigs, BOOTSTRAP_ROLE_CONFIGS } = require('../out/swarm/roleConfigReader');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarmforge-test-'));
}

test('readRoleConfigs returns bootstrap defaults when roles.tsv absent', () => {
  const dir = makeTmpDir();
  const configs = readRoleConfigs(dir);
  assert.deepEqual(configs, BOOTSTRAP_ROLE_CONFIGS);
  fs.rmSync(dir, { recursive: true });
});

test('readRoleConfigs parses a valid roles.tsv', () => {
  const dir = makeTmpDir();
  const sfDir = path.join(dir, '.swarmforge');
  fs.mkdirSync(sfDir);
  fs.writeFileSync(
    path.join(sfDir, 'roles.tsv'),
    'specifier\tSpecifier\tclaude\t--role=specifier\ncoder\tCoder\tclaude\t--role=coder\n'
  );
  const configs = readRoleConfigs(dir);
  assert.equal(configs.length, 2);
  assert.equal(configs[0].role, 'specifier');
  assert.equal(configs[0].displayName, 'Specifier');
  assert.equal(configs[0].command, 'claude');
  assert.deepEqual(configs[0].args, ['--role=specifier']);
  assert.equal(configs[1].role, 'coder');
  fs.rmSync(dir, { recursive: true });
});

test('readRoleConfigs skips blank lines in roles.tsv', () => {
  const dir = makeTmpDir();
  const sfDir = path.join(dir, '.swarmforge');
  fs.mkdirSync(sfDir);
  fs.writeFileSync(
    path.join(sfDir, 'roles.tsv'),
    'coder\tCoder\tclaude\t--role=coder\n\n'
  );
  const configs = readRoleConfigs(dir);
  assert.equal(configs.length, 1);
  fs.rmSync(dir, { recursive: true });
});
