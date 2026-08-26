'use strict';

// BL-964: step handlers for "wrong-prefix ensure env-var regression gate".
// Drives the REAL guard module (extension/test/helpers/
// retiredEnsureEnvVarGuard.js - deliberately outside the guarded
// directories, where the literals may live). THIS file sits in a guarded
// directory, so per the ticket's firm trap-resistance constraint it never
// spells a retired name contiguously: every needle is assembled at runtime
// from split parts, including the KNOWN_VALUES the Outline tokens are
// validated against.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const {
  RETIRED_ENSURE_ENV_VARS,
  scanDirForRetiredEnsureVars,
} = require('../../../extension/test/helpers/retiredEnsureEnvVarGuard');

const FEATURE = 'BL-964 wrong-prefix ensure env-var regression gate';

const RETIRED_PREFIX = 'SWARMFORGE_' + 'ENSURE_';

// The Outline's <var> tokens, assembled from split parts - never the
// contiguous literal in this (guarded) file.
const KNOWN_VARS = new Set([
  RETIRED_PREFIX + 'EXTENSION_CHECK',
  RETIRED_PREFIX + 'EXTENSION_BOUNCE',
  RETIRED_PREFIX + 'SUPERVISOR',
]);

const KNOWN_DIRS = new Set(['swarmforge/scripts/test', 'specs/pipeline/steps']);

function knownVar(token) {
  if (!KNOWN_VARS.has(token)) throw new Error(`unknown <var> token: ${token}`);
  return token;
}

function knownDir(token) {
  if (!KNOWN_DIRS.has(token)) throw new Error(`unknown <dir> token: ${token}`);
  return token;
}

let trackedRoots = [];

afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // Self-check once at registration: the runtime-assembled needle set must
  // be exactly the guard module's own - a drifting copy here would validate
  // Outline tokens against the wrong contract.
  assert.deepEqual([...KNOWN_VARS].sort(), [...RETIRED_ENSURE_ENV_VARS].sort());

  scoped(/^a scratch tree containing a test file under "([^"]+)" that sets "([^"]+)"$/, (ctx, dirToken, varToken) => {
    const dir = knownDir(dirToken);
    const retired = knownVar(varToken);
    ctx.root = mkSocketFixtureRoot('bl964-');
    trackedRoots.push(ctx.root);
    const target = path.join(ctx.root, dir);
    fs.mkdirSync(target, { recursive: true });
    ctx.offender = path.join(target, 'test_scratch_offender.sh');
    ctx.retired = retired;
    fs.writeFileSync(ctx.offender, `export ${retired}=/fake/hook\n`);
    ctx.scanDirs = [path.join(ctx.root, 'specs/pipeline/steps'), path.join(ctx.root, 'swarmforge/scripts/test')];
  });

  scoped(/^a scratch tree whose test files set only the SWARM_ENSURE_\*_CMD env vars$/, (ctx) => {
    ctx.root = mkSocketFixtureRoot('bl964-ok-');
    trackedRoots.push(ctx.root);
    for (const dir of KNOWN_DIRS) {
      const target = path.join(ctx.root, dir);
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(
        path.join(target, 'test_correct_seams.sh'),
        'export SWARM_ENSURE_EXTENSION_CHECK_CMD=/fake/check\n' +
          'export SWARM_ENSURE_EXTENSION_BOUNCE_CMD=/fake/bounce\n' +
          'export SWARM_ENSURE_SUPERVISOR_CMD=/fake/supervisor\n'
      );
    }
    ctx.scanDirs = [path.join(ctx.root, 'specs/pipeline/steps'), path.join(ctx.root, 'swarmforge/scripts/test')];
  });

  scoped(/^the regression gate runs against that tree$/, (ctx) => {
    ctx.violations = ctx.scanDirs.flatMap((d) => scanDirForRetiredEnsureVars(d));
  });

  scoped(/^the gate fails naming that file and the retired string$/, (ctx) => {
    assert.ok(ctx.violations.length >= 1, `expected the gate to fail, got zero violations`);
    assert.ok(
      ctx.violations.some((v) => v.file === ctx.offender && v.retired === ctx.retired),
      `expected a violation naming ${ctx.offender} and ${ctx.retired}, got: ${JSON.stringify(ctx.violations)}`
    );
  });

  scoped(/^the gate passes$/, (ctx) => {
    assert.deepEqual(ctx.violations, [], `expected the gate to pass, got: ${JSON.stringify(ctx.violations)}`);
  });
}

module.exports = { registerSteps };
