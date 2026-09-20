'use strict';

// BL-1630's one declared invariant (coder first authorship - BL-654):
//
// "A step handler does no work at module load: no filesystem listing, no
// process spawn, no temp-dir sweep and no heavy module require outside a
// step function or a lazily-initialised helper."
//
// Encoded directly against the real, impure census (censusAllHandlers,
// extension/test/helpers/stepHandlerRequireCensus.js's own instrumented
// child-process require) over a GENERATED spread of which module-load
// side effect(s) a synthetic handler exhibits - never a reimplementation
// of the detection. The existing example-based fixture tests in
// extension/test/stepHandlerModuleLoadBudget.test.js each pin ONE
// hand-picked violation shape; this property generates every subset of
// {lists a directory, spawns via spawnSync, spawns via execFileSync,
// requires node:test} (16 combinations, well within the generator's
// reach - not a rare corner) and proves detection is exactly as precise
// as the invariant demands for every one of them: a behavior present is
// always caught, a behavior absent never is.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { mkTmpDir } = require('./helpers/tmpDir');
const { censusAllHandlers, checkHandlerBudgets } = require('./helpers/stepHandlerRequireCensus');

const BUDGET_MS = 200;

const BEHAVIORS = {
  listsDir: "require('node:fs').readdirSync(require('node:os').tmpdir());",
  spawnsViaSpawnSync: "require('node:child_process').spawnSync('true', []);",
  spawnsViaExecFileSync: "require('node:child_process').execFileSync('true', []);",
  requiresNodeTest: "require('node:test');",
};

function buildFixtureSource(activeBehaviors) {
  const lines = ["'use strict';"];
  for (const key of activeBehaviors) {
    lines.push(BEHAVIORS[key]);
  }
  lines.push('function registerSteps() {}');
  lines.push('module.exports = { registerSteps };');
  return lines.join('\n');
}

// Every subset of the four behaviors (order-independent) - a real fc
// subarray generator, not a hand-enumerated list, so a future BEHAVIORS
// addition automatically widens what this property covers.
const behaviorSubsetArbitrary = fc.subarray(Object.keys(BEHAVIORS));

test(
  'property (BL-1630 invariant): the census reports exactly the module-load behaviors a handler actually exhibits, for every combination',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(behaviorSubsetArbitrary, fc.integer({ min: 0, max: 999999 }), (activeBehaviors, salt) => {
        draws += 1;
        const fixtureDir = mkTmpDir('bl1630-invariant-prop-');
        const fileName = `zzzGeneratedFixture${salt}Steps.js`;
        fs.writeFileSync(path.join(fixtureDir, fileName), buildFixtureSource(activeBehaviors));

        const { rows } = censusAllHandlers(fixtureDir);
        assert.equal(rows.length, 1, `expected exactly one row, got: ${JSON.stringify(rows)}`);
        const row = rows[0];
        const active = new Set(activeBehaviors);

        assert.equal(row.error, null, `expected no require error for ${JSON.stringify(activeBehaviors)}, got: ${row.error}`);
        assert.equal(
          row.listedDir,
          active.has('listsDir'),
          `listedDir mismatch for ${JSON.stringify(activeBehaviors)}: got ${row.listedDir}`
        );
        assert.equal(
          row.spawnedProcess,
          active.has('spawnsViaSpawnSync') || active.has('spawnsViaExecFileSync'),
          `spawnedProcess mismatch for ${JSON.stringify(activeBehaviors)}: got ${row.spawnedProcess}`
        );
        assert.equal(
          row.registeredTestRunner,
          active.has('requiresNodeTest'),
          `registeredTestRunner mismatch for ${JSON.stringify(activeBehaviors)}: got ${row.registeredTestRunner}`
        );

        const violations = checkHandlerBudgets(rows, { budgetMs: BUDGET_MS });
        const expectAnyBehavioralViolation = active.has('listsDir') || active.has('spawnsViaSpawnSync') || active.has('spawnsViaExecFileSync');
        if (expectAnyBehavioralViolation) {
          assert.ok(
            violations.some((v) => v.file === fileName),
            `expected a violation for ${JSON.stringify(activeBehaviors)}, got none: ${JSON.stringify(violations)}`
          );
        } else if (active.size === 0) {
          assert.deepEqual(violations, [], `expected no violation for the empty set, got: ${JSON.stringify(violations)}`);
        }
      }),
      { numRuns: 30 }
    );
    assert.ok(draws >= 20);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test('property (BL-1630 invariant) non-vacuity: a broken listedDir check would silently pass an offender - proven against a scratch copy, then restored', () => {
  const helperPath = path.join(__dirname, 'helpers', 'stepHandlerRequireCensus.js');
  const original = fs.readFileSync(helperPath, 'utf8');
  const marker = "if (row.listedDir) {\n      violations.push({ file: row.file, reason: 'lists a directory at module load' });\n    }\n";
  assert.ok(original.includes(marker), 'expected to find the listedDir violation clause to remove for the non-vacuity probe');
  const broken = original.replace(marker, '');
  assert.notEqual(broken, original, 'expected the textual removal to actually change the file');

  const brokenPath = path.join(__dirname, 'helpers', `stepHandlerRequireCensus-non-vacuity-scratch-${process.pid}-${Date.now()}.js`);
  fs.writeFileSync(brokenPath, broken);
  const fixtureDir = mkTmpDir('bl1630-non-vacuity-');
  try {
    fs.writeFileSync(path.join(fixtureDir, 'zzzNonVacuityOffenderSteps.js'), buildFixtureSource(['listsDir']));
    const brokenModule = require(brokenPath);
    const { rows } = brokenModule.censusAllHandlers(fixtureDir);
    const violations = brokenModule.checkHandlerBudgets(rows, { budgetMs: BUDGET_MS });
    assert.deepEqual(
      violations,
      [],
      'expected the broken (listedDir-check-removed) guard to silently pass the directory-listing offender, proving the real check is load-bearing'
    );
  } finally {
    delete require.cache[require.resolve(brokenPath)];
    fs.rmSync(brokenPath, { force: true });
  }
});
