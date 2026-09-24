'use strict';

// BL-1723: step handlers for "The orphan janitor sees bl-prefixed fixture
// roots on Linux". Drives the REAL classifier
// (orphan_janitor_lib.bb/tmp-ancillary-cmdline?, via BL-849's own
// `ancillary-cmdline-recognized` subcommand on
// bl849_orphan_janitor_acceptance_runner.bb) - never a reimplementation of
// the regex in JS.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl849_orphan_janitor_acceptance_runner.bb');

const FEATURE_NAME = 'BL-1723 The orphan janitor sees bl-prefixed fixture roots on Linux';

function ancillaryCmdlineRecognized(cmdline) {
  const out = execFileSync('bb', [RUNNER, 'ancillary-cmdline-recognized', JSON.stringify({ cmdline })], { encoding: 'utf8' });
  return JSON.parse(out).isCandidate;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^the janitor classifies the command line "(.+)"$/, (ctx, cmdline) => {
    ctx.isCandidate = ancillaryCmdlineRecognized(cmdline);
  });

  scoped(/^it is a disposable-root ancillary candidate$/, (ctx) => {
    if (!ctx.isCandidate) {
      throw new Error('expected the command line to be recognized as a disposable-root ancillary candidate');
    }
  });

  scoped(/^it is not a disposable-root ancillary candidate$/, (ctx) => {
    if (ctx.isCandidate) {
      throw new Error('expected the command line to NOT be recognized as a disposable-root ancillary candidate');
    }
  });
}

module.exports = { registerSteps };
