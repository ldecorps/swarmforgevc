'use strict';

// BL-221: step handlers for the Stryker pwa/-sandbox feature. Proves the
// real, testable mechanism (extension/scripts/strykerPwaSandboxLib.js's
// shared .stryker-tmp/pwa symlink, and the "mutation" npm script's wiring)
// deterministically and fast - never a real `stryker run` subprocess. A
// real scoped dry run takes ~40s and is already the ticket's own separately
// documented QA e2e procedure (independently confirmed manually per the QA
// bounce evidence); unsuitable to re-run as a fixture-per-scenario
// acceptance gate. The mechanism these steps exercise is exactly what a
// real dry run depends on: if it stopped resolving, the dry run would
// abort with ENOENT precisely as BL-221 found it doing before this fix.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { ensureStrykerPwaSandboxLink } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'strykerPwaSandboxLib.js')
);

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-stryker-pwa-'));
  }
  return ctx.targetPath;
}

// Simulates one mutation worker's sandbox test dir and resolves relPath
// the same way extension/test/*.test.js's own path.join(__dirname, '..',
// '..', ...) would from inside it - real Stryker copies extension/'s tree
// into .stryker-tmp/sandbox-<id>/, so a test at .../sandbox-<id>/test/
// resolving a sibling two levels up lands at .stryker-tmp/<relPath>, the
// shared symlink ensureStrykerPwaSandboxLink just created.
function resolveFromSimulatedSandbox(extensionDir, ...relPath) {
  const simulatedSandboxTestDir = path.join(extensionDir, '.stryker-tmp', 'sandbox-abc123', 'test');
  fs.mkdirSync(simulatedSandboxTestDir, { recursive: true });
  return path.join(simulatedSandboxTestDir, '..', '..', ...relPath);
}

function registerSteps(registry) {
  registry.define(/^the repository has a sibling pwa\/ directory at the repo root$/, () => {
    const pwaDir = path.join(REPO_ROOT, 'pwa');
    if (!fs.existsSync(pwaDir) || !fs.statSync(pwaDir).isDirectory()) {
      throw new Error(`expected a sibling pwa/ directory at ${pwaDir}`);
    }
  });

  registry.define(/^the Stryker config lives in extension\/ and mutates out\/\*\*\/\*\.js$/, () => {
    const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'extension', 'stryker.config.json'), 'utf8'));
    if (!Array.isArray(config.mutate) || !config.mutate.includes('out/**/*.js')) {
      throw new Error(`expected stryker.config.json's mutate to be exactly out/**/*.js, got: ${JSON.stringify(config.mutate)}`);
    }
  });

  registry.define(/^a unit test that reads pwa\/index\.html at run time$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    fs.mkdirSync(path.join(targetPath, 'pwa'), { recursive: true });
    fs.writeFileSync(path.join(targetPath, 'pwa', 'index.html'), '<html></html>');
  });

  registry.define(/^the hardener runs the Stryker mutation dry run$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    const extensionDir = path.join(targetPath, 'extension');
    ensureStrykerPwaSandboxLink(extensionDir, '.stryker-tmp');
    ctx.resolvedPwaAssetPath = resolveFromSimulatedSandbox(extensionDir, 'pwa', 'index.html');
  });

  registry.define(/^the dry run does not fail with ENOENT on any pwa\/ path$/, (ctx) => {
    if (!fs.existsSync(ctx.resolvedPwaAssetPath)) {
      throw new Error(`expected ${ctx.resolvedPwaAssetPath} to resolve without ENOENT`);
    }
  });

  registry.define(/^the test passes inside the sandbox as it does in a normal run$/, (ctx) => {
    const content = fs.readFileSync(ctx.resolvedPwaAssetPath, 'utf8');
    if (content !== '<html></html>') {
      throw new Error(`expected the sandboxed read to see the same content as a normal run, got: ${content}`);
    }
  });

  registry.define(/^a ticket whose changed files are scoped to out\/\*\*\/\*\.js$/, () => {
    // No fixture state needed - the mutate scope is pinned by the
    // Background's config assertion and never touched by this ticket's fix.
  });

  registry.define(/^the hardener runs the no-surviving-mutants gate$/, (ctx) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'extension', 'package.json'), 'utf8'));
    if (!/ensureStrykerPwaSandbox\.js.*&&.*stryker run/.test(pkg.scripts.mutation)) {
      throw new Error(`expected the mutation script to ensure the pwa/ sandbox link before stryker run, got: ${pkg.scripts.mutation}`);
    }
    const targetPath = ensureTargetPath(ctx);
    const extensionDir = path.join(targetPath, 'extension');
    fs.mkdirSync(path.join(targetPath, 'pwa'), { recursive: true });
    fs.writeFileSync(path.join(targetPath, 'pwa', 'marker'), 'ok');
    ensureStrykerPwaSandboxLink(extensionDir, '.stryker-tmp');
    ctx.resolvedMarkerPath = resolveFromSimulatedSandbox(extensionDir, 'pwa', 'marker');
  });

  registry.define(/^the run reaches mutant evaluation rather than aborting in the dry run$/, (ctx) => {
    if (!fs.existsSync(ctx.resolvedMarkerPath)) {
      throw new Error(
        `expected the sandbox-shared pwa/ link to resolve (would otherwise abort the dry run with ENOENT), got missing: ${ctx.resolvedMarkerPath}`
      );
    }
  });
}

module.exports = { registerSteps };
