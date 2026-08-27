'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { writeEntryPoints } = require('./generate');

function repoRoot() {
  return path.resolve(__dirname, '..', '..');
}

// feature file -> gherkin-parser -> JSON IR (engineering.prompt's Acceptance
// Pipeline chain). Shells out to the pinned Babashka tool vendored by BL-111
// under swarmforge/vendor/aps/ - never reimplemented here.
function parseFeatureFile(featureFilePath) {
  const vendorDir = path.join(repoRoot(), 'swarmforge', 'vendor', 'aps');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-ir-'));
  const irPath = path.join(tmpDir, 'ir.json');
  try {
    execFileSync('bb', ['gherkin-parser', path.resolve(featureFilePath), irPath], { cwd: vendorDir });
    return JSON.parse(fs.readFileSync(irPath, 'utf8'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Runs generated entry points with Node's built-in test runner, decoupled
// from the extension's Vitest run so acceptance runs stay sequential and
// never overlap a whole-suite unit run (engineering.prompt's Verification
// rule; BL-112 acceptance-pipeline-03).
function runGeneratedTests(filePaths) {
  // Strip NODE_TEST_CONTEXT: when this adapter itself runs inside a `node
  // --test` process (e.g. its own unit/e2e tests), Node sets that var and a
  // spawned child inheriting it treats this as a nested run and silently
  // skips executing the files instead of running them.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', ...filePaths], { encoding: 'utf8', env });
  return { success: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}` };
}

async function runPipeline(featureFilePath, outDir, stepsModulePath, deps = {}) {
  const parse = deps.parse || parseFeatureFile;
  const generate = deps.generate || ((feature) => writeEntryPoints(feature, outDir, { stepsModulePath }));
  const run = deps.run || runGeneratedTests;

  const feature = await parse(featureFilePath);
  const generatedPath = await generate(feature);
  return run([generatedPath]);
}

module.exports = { parseFeatureFile, runGeneratedTests, runPipeline, repoRoot };
