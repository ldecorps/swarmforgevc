const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { parseArgs, realAdapters } = require('../out/tools/mutation-site-count');
const { countMutationSites } = require('../out/quality/mutationSiteCount');

// BL-485: the REAL @stryker-mutator/instrumenter wiring - never mocked,
// stubbed, or faked, per this codebase's own dependencyGateCli*.test.js
// precedent (mutationSiteCount.test.js proves the pure counting/mapping/
// threshold logic against a fake countMutantsPerFile; this file proves
// the real adapter that actually drives Stryker's instrumentation step).

function mkFixtureFile(content) {
  const dir = mkTmpDir('bl485-fixture-');
  const file = path.join(dir, 'fixture.js');
  fs.writeFileSync(file, content);
  return file;
}

// ── parseArgs (pure) ───────────────────────────────────────────────────

test('parseArgs: no --threshold flag uses the default threshold and every arg is a changed file', () => {
  assert.deepEqual(parseArgs(['a.ts', 'b.ts']), { threshold: 100, files: ['a.ts', 'b.ts'] });
});

test('parseArgs: --threshold N is extracted from anywhere among the args, remaining args are files', () => {
  assert.deepEqual(parseArgs(['--threshold', '50', 'a.ts']), { threshold: 50, files: ['a.ts'] });
  assert.deepEqual(parseArgs(['a.ts', '--threshold', '25']), { threshold: 25, files: ['a.ts'] });
});

test('parseArgs: a non-numeric --threshold value falls back to the default rather than producing NaN', () => {
  assert.deepEqual(parseArgs(['--threshold', 'oops', 'a.ts']), { threshold: 100, files: ['a.ts'] });
});

// ── the REAL Stryker instrumenter (mutation-site-size-gate-01/03) ───────

test('the REAL @stryker-mutator/instrumenter counts genuine mutation sites in a real fixture file, count-only', async () => {
  const file = mkFixtureFile('function add(a, b) { return a + b; }\nmodule.exports = { add };\n');

  const [result] = await countMutationSites([file], realAdapters);

  assert.ok(result.siteCount > 0, `expected at least one real mutant, got ${result.siteCount}`);
  // count-only: the result carries no kill/pass/test-execution field.
  assert.deepEqual(Object.keys(result).sort(), ['file', 'outPath', 'siteCount']);
});

// ── entrypoint-boilerplate parity with the real gate (BL-447) ───────────

test('the REAL instrumenter excludes entrypoint-boilerplate mutants, matching what the real hardener gate would count', async () => {
  const withBoilerplate = mkFixtureFile(
    [
      'Object.defineProperty(exports, "__esModule", { value: true });',
      'function main() { return 1; }',
      'if (require.main === module) { main(); }',
    ].join('\n') + '\n'
  );
  const bareEquivalent = mkFixtureFile('function main() { return 1; }\n');

  const [withBoilerplateResult] = await countMutationSites([withBoilerplate], realAdapters);
  const [bareResult] = await countMutationSites([bareEquivalent], realAdapters);

  assert.equal(
    withBoilerplateResult.siteCount,
    bareResult.siteCount,
    'expected the __esModule/require.main boilerplate to contribute zero extra sites over the bare equivalent'
  );
});
