'use strict';

// BL-1430: step handlers for "the portable-time guard has one definition".
// Scenario 01 greps the SAME scope a reader would check by hand
// (extension/src and specs/pipeline - the ticket's own "How" direction),
// deliberately independent of bl874PortableTimeInvariants.property.test.js's
// own repo-wide walk (which this ticket also fixed, in the same parcel, to
// exclude .worktrees) - two different counting mechanisms agreeing is the
// point, never one restating the other. Scenario 02 runs that property file
// for real, under the real properties config, never a reimplementation.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');

const FEATURE = 'BL-1430 The portable-time guard has one definition';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ───────────────────────────────────────────────────────
  scoped(/^every definition of findPortableTimeViolation under extension\/src and specs\/pipeline is counted$/, (ctx) => {
    // git grep exits 1 when it finds nothing - :continue-shaped, never a throw.
    const res = spawnSync(
      'git',
      ['grep', '-l', 'function findPortableTimeViolation', '--', 'extension/src', 'specs/pipeline'],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    const files = (res.stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    ctx.bl1430 = { definitionFiles: files, exitCode: res.status };
  });

  scoped(/^exactly one file defines it$/, (ctx) => {
    const { definitionFiles } = ctx.bl1430;
    if (definitionFiles.length !== 1) {
      throw new Error(
        `expected exactly one definition of findPortableTimeViolation under extension/src and specs/pipeline, ` +
          `found ${definitionFiles.length}: ${JSON.stringify(definitionFiles)}`
      );
    }
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────
  scoped(/^bl874PortableTimeInvariants\.property\.test\.js is run alone under the properties config$/, (ctx) => {
    ctx.bl1430 = ctx.bl1430 || {};
    ctx.bl1430.propertyRun = spawnSync(
      'npx',
      ['vitest', 'run', '--config', 'vitest.properties.config.mjs', 'test/bl874PortableTimeInvariants.property.test.js'],
      { cwd: EXTENSION_DIR, encoding: 'utf8' }
    );
  });

  scoped(/^it passes$/, (ctx) => {
    const res = ctx.bl1430.propertyRun;
    if (res.status !== 0) {
      throw new Error(
        `expected bl874PortableTimeInvariants.property.test.js to pass alone, exit ${res.status}\n` +
          `stdout: ${res.stdout}\nstderr: ${res.stderr}`
      );
    }
  });
}

module.exports = { registerSteps };
