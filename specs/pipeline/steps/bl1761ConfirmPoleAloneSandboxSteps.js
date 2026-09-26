'use strict';

// BL-1761: step handlers for "confirmPoleAlone finds a repo-relative test
// file inside a Stryker sandbox". Scenario 01 drives the REAL
// confirmPoleAlone (extension/scripts/recordTestDuration.js) against a REAL
// on-disk fixture shaped exactly like a Stryker sandbox: an "extension
// root" whose own parent has no "extension" child. recordTestDuration.js is
// COPIED into the fixture (never symlinked) so its own __dirname/ROOT_DIR
// resolve to the fixture itself, matching the BL-1066 rule that a Stryker
// sandbox dir IS the extension root. Everything the copy requires but does
// not itself change (testDurationRecorderLib.js, out/, node_modules/, the
// vitest config) is symlinked in from the real checkout. Scenario 02 drives
// the SAME real function, unmodified, from the real checkout - proving the
// fix changes nothing there.
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('../../../extension/test/helpers/tmpDir');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const FEATURE_NAME = 'BL-1761 confirmPoleAlone finds a repo-relative test file inside a Stryker sandbox';

function symlink(target, linkPath) {
  fs.symlinkSync(target, linkPath, fs.statSync(target).isDirectory() ? 'dir' : 'file');
}

function registerSteps(registry) {
  registry.defineScoped(
    /^recordTestDuration\.js copied into an extension root whose parent has no extension directory$/,
    (ctx) => {
      // outerParent stands in for .stryker-tmp/ - a freshly minted temp
      // dir is guaranteed to have no "extension" child of its own.
      const outerParent = mkTmpDir('bl1761-sandbox-parent-');
      const sandboxRoot = path.join(outerParent, 'sandbox-root');
      fs.mkdirSync(path.join(sandboxRoot, 'scripts'), { recursive: true });
      fs.copyFileSync(
        path.join(EXTENSION_DIR, 'scripts', 'recordTestDuration.js'),
        path.join(sandboxRoot, 'scripts', 'recordTestDuration.js')
      );
      symlink(
        path.join(EXTENSION_DIR, 'scripts', 'testDurationRecorderLib.js'),
        path.join(sandboxRoot, 'scripts', 'testDurationRecorderLib.js')
      );
      symlink(path.join(EXTENSION_DIR, 'out'), path.join(sandboxRoot, 'out'));
      symlink(path.join(EXTENSION_DIR, 'node_modules'), path.join(sandboxRoot, 'node_modules'));
      symlink(path.join(EXTENSION_DIR, 'vitest.config.mjs'), path.join(sandboxRoot, 'vitest.config.mjs'));
      ctx.__disposables = ctx.__disposables || [];
      ctx.__disposables.push(() => fs.rmSync(outerParent, { recursive: true, force: true }));
      ctx.sandboxRoot = sandboxRoot;
      // Requires the FIXTURE'S OWN copy (a distinct absolute path from the
      // real module, so Node's require cache never conflates the two) -
      // its confirmPoleAlone closes over ITS OWN ROOT_DIR/REPO_ROOT_DIR,
      // computed from the copy's own __dirname.
      ctx.confirmPoleAlone = require(path.join(sandboxRoot, 'scripts', 'recordTestDuration.js')).confirmPoleAlone;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^that extension root holds a small passing test under test\/$/,
    (ctx) => {
      fs.mkdirSync(path.join(ctx.sandboxRoot, 'test'), { recursive: true });
      ctx.sandboxTestFile = 'bl1761-sandbox-fixture.test.js';
      fs.writeFileSync(
        path.join(ctx.sandboxRoot, 'test', ctx.sandboxTestFile),
        "test('bl1761 sandbox fixture passes', () => {});\n"
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^confirmPoleAlone confirms that test by its repo-relative path$/,
    (ctx) => {
      ctx.result = ctx.confirmPoleAlone(`extension/test/${ctx.sandboxTestFile}`);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^confirmPoleAlone confirms "([^"]+)" from the real checkout$/,
    (ctx, file) => {
      const { confirmPoleAlone } = require(path.join(EXTENSION_DIR, 'scripts', 'recordTestDuration.js'));
      ctx.result = confirmPoleAlone(file);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it returns a measured duration$/,
    (ctx) => {
      if (!ctx.result || typeof ctx.result !== 'object') {
        throw new Error(`expected an object result, got: ${JSON.stringify(ctx.result)}`);
      }
      if ('failed' in ctx.result) {
        throw new Error(`expected a successful {ms} result, got: ${JSON.stringify(ctx.result)}`);
      }
      if (typeof ctx.result.ms !== 'number' || ctx.result.ms < 0) {
        throw new Error(`expected a non-negative numeric duration, got: ${JSON.stringify(ctx.result)}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
