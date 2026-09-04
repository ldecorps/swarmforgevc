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
// BL-1358: the per-mutant time ceiling, in milliseconds. Human ruling,
// 2026-09-03: 300 seconds - generous headroom over the slowest legitimate
// scenario in the tree (real-git fixture scenarios run 10-20s each) while
// catching a wedge in minutes rather than the 808 seconds the incident ran.
const DEFAULT_MUTANT_TIMEOUT_MS = 300000;

// Configurable rather than a literal, so a slow host raises it without editing
// code. An unparseable or non-positive value falls back to the default rather
// than disabling the ceiling: "no ceiling" is the state this ticket exists to
// end, and it must not be reachable through a typo in an env var.
function resolveMutantTimeoutMs(explicit) {
  for (const candidate of [explicit, process.env.GHERKIN_MUTATION_TIMEOUT_MS]) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_MUTANT_TIMEOUT_MS;
}

function runGeneratedTests(filePaths, opts = {}) {
  // Strip NODE_TEST_CONTEXT: when this adapter itself runs inside a `node
  // --test` process (e.g. its own unit/e2e tests), Node sets that var and a
  // spawned child inheriting it treats this as a nested run and silently
  // skips executing the files instead of running them.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  // BL-1358: this spawnSync IS the wait the harness had no ceiling on. A
  // mutant that hangs - for any reason, not only the leaked client of BL-1357
  // - held its worker until a person noticed, measured at 808 seconds. The
  // ceiling lives here, where the wait is, so the kill actually reclaims the
  // worker rather than leaving an orphan behind it.
  const timeoutMs = resolveMutantTimeoutMs(opts.timeoutMs);
  const result = spawnSync(process.execPath, ['--test', ...filePaths], {
    encoding: 'utf8',
    env,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    // The child leads its own process group so the group kill below reaches
    // everything the mutant shelled out to. spawnSync's own timeout kills the
    // DIRECT CHILD only, and a scenario that spawned a bb tool or a bridge
    // would leave those descendants running - the scar this repo already
    // carries as `kill -KILL -- -PGID` in the engineering rules.
    detached: true,
  });
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  if (timedOut && typeof result.pid === 'number' && result.pid > 0) {
    try {
      process.kill(-result.pid, 'SIGKILL');
    } catch {
      // ESRCH: the group is already gone, which is the outcome wanted here.
      // EPERM/ENOSYS: nothing further this process can do, and reporting the
      // timeout still beats waiting forever.
    }
  }
  return {
    // Human ruling option 1: a mutant that never finished was not PROVEN
    // killed, so it is not a success and it fails the gate exactly as a
    // survivor does.
    success: !timedOut && result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`,
    timedOut,
    timeoutMs,
  };
}

async function runPipeline(featureFilePath, outDir, stepsModulePath, deps = {}) {
  const parse = deps.parse || parseFeatureFile;
  const generate = deps.generate || ((feature) => writeEntryPoints(feature, outDir, { stepsModulePath }));
  const run = deps.run || runGeneratedTests;

  const feature = await parse(featureFilePath);
  const generatedPath = await generate(feature);
  return run([generatedPath]);
}

module.exports = {
  parseFeatureFile,
  runGeneratedTests,
  runPipeline,
  repoRoot,
  resolveMutantTimeoutMs,
  DEFAULT_MUTANT_TIMEOUT_MS,
};
