const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BL-048: mutation (Stryker) + DRY (jscpd) tooling for the hardener.
// These pin the wiring contract: dedicated scripts, separate from `npm test`,
// with committed config.

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

test('stryker and jscpd are devDependencies only', () => {
  assert.ok(pkg.devDependencies['@stryker-mutator/core'], 'stryker must be a devDependency');
  assert.ok(pkg.devDependencies['jscpd'], 'jscpd must be a devDependency');
  assert.ok(!pkg.dependencies || !pkg.dependencies['@stryker-mutator/core']);
  assert.ok(!pkg.dependencies || !pkg.dependencies['jscpd']);
});

test('mutation and dry run via their own scripts, not npm test', () => {
  assert.ok(pkg.scripts.mutation, 'must define a mutation script');
  assert.match(pkg.scripts.mutation, /stryker run/, 'mutation script must invoke stryker');
  assert.ok(pkg.scripts.dry, 'must define a dry script');
  assert.match(pkg.scripts.dry, /jscpd/, 'dry script must invoke jscpd');
  assert.ok(
    !/stryker|jscpd/.test(pkg.scripts.test),
    'npm test must stay separate from mutation/DRY tooling'
  );
});

test('stryker config mutates the built output and runs coverage-aware (perTest)', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../stryker.config.json'), 'utf8')
  );
  assert.equal(config.testRunner, 'vitest', 'suite runs via the Vitest runner (BL-124)');
  assert.equal(
    config.coverageAnalysis,
    'perTest',
    'coverage-aware perTest — only the tests covering a mutant run — is the whole point of the Vitest migration'
  );
  assert.ok(
    config.mutate.some((p) => p.startsWith('out/')),
    'mutants are generated in the compiled output the tests actually execute'
  );
  assert.ok(
    !config.mutate.some((p) => p.includes('test')),
    'test files must not be mutated'
  );
  assert.equal(config.incremental, true, 'incremental manifest enables differential runs');
});

test('jscpd config scans the TypeScript source', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../.jscpd.json'), 'utf8')
  );
  assert.ok(config.reporters.includes('console'), 'duplication must be reported to the console');
});

// BL-221: the Stryker sandbox never copies the sibling repo-root pwa/
// directory, so every mutation dry run ENOENTs on any pwa/ asset a test
// resolves at runtime, aborting the whole gate before any mutant is
// evaluated. The mutation script must ensure the sandbox-shared pwa/ link
// exists before stryker runs, every time - not a manual one-off step a
// human has to remember.
test('mutation script ensures the Stryker pwa/ sandbox link before running stryker', () => {
  assert.match(
    pkg.scripts.mutation,
    /ensureStrykerPwaSandbox\.js.*&&.*stryker run/,
    'mutation script must ensure the pwa/ sandbox link exists, before invoking stryker run'
  );
  assert.ok(
    fs.existsSync(path.join(__dirname, '../scripts/ensureStrykerPwaSandbox.js')),
    'ensureStrykerPwaSandbox.js must be committed alongside the other hardener scripts'
  );
});
