'use strict';

// BL-221/BL-267: step handlers for the Stryker sandbox-sibling features.
// Proves the real, testable mechanism (extension/scripts/
// strykerSandboxSiblingsLib.js's shared .stryker-tmp/<sibling> symlinks,
// and the "mutation" npm script's wiring) deterministically and fast -
// never a real `stryker run` subprocess. A real scoped dry run takes ~40s
// and is already each ticket's own separately documented QA e2e procedure;
// unsuitable to re-run as a fixture-per-scenario acceptance gate. The
// mechanism these steps exercise is exactly what a real dry run depends
// on: if it stopped resolving, the dry run would abort with ENOENT
// precisely as BL-221/BL-267 found it doing before their fixes.
//
// Registers step text for BOTH specs/features/BL-221-... (pwa/-specific,
// unchanged text) and specs/features/BL-267-... (generalized, parametrized
// by <sibling>) - the underlying mechanism is now the same for both.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { ensureStrykerSandboxSiblingLink, ensureStrykerSandboxSiblingLinks } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'strykerSandboxSiblingsLib.js')
);

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

// BL-267 constraint: a Scenario Outline's Examples column value must be
// validated against an explicit lookup, not a passthrough/binary check, so
// a gherkin-mutator mutation of the example value fails the acceptance run
// instead of silently taking an "else" branch.
const KNOWN_SIBLING_CHECK_FILES = {
  pwa: 'index.html',
  swarmforge: path.join('scripts', 'compliance_battery.bb'),
};

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-stryker-sandbox-'));
  }
  return ctx.targetPath;
}

// Simulates one mutation worker's sandbox test dir and resolves relPath
// the same way extension/test/*.test.js's own path.join(__dirname, '..',
// '..', ...) would from inside it - real Stryker copies extension/'s tree
// into .stryker-tmp/sandbox-<id>/, so a test at .../sandbox-<id>/test/
// resolving a sibling two levels up lands at .stryker-tmp/<relPath>, the
// shared symlink ensureStrykerSandboxSiblingLink just created.
function resolveFromSimulatedSandboxTestDir(extensionDir, ...relPath) {
  const simulatedSandboxTestDir = path.join(extensionDir, '.stryker-tmp', 'sandbox-abc123', 'test');
  fs.mkdirSync(simulatedSandboxTestDir, { recursive: true });
  return path.join(simulatedSandboxTestDir, '..', '..', ...relPath);
}

// Same shared-symlink target, but resolved the way complianceBatteryGate.ts
// actually does it: REPO_ROOT = path.join(__dirname, '..', '..', '..') from
// extension/out/recruiter/ - THREE levels up, landing at .stryker-tmp/
// itself (one level shallower than the test-dir shape above), not two.
function resolveFromSimulatedSandboxRecruiterDir(extensionDir, ...relPath) {
  const simulatedSandboxRecruiterDir = path.join(extensionDir, '.stryker-tmp', 'sandbox-abc123', 'out', 'recruiter');
  fs.mkdirSync(simulatedSandboxRecruiterDir, { recursive: true });
  return path.join(simulatedSandboxRecruiterDir, '..', '..', '..', ...relPath);
}

function registerSteps(registry) {
  // ── shared Background steps ─────────────────────────────────────────
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

  // BL-267 Background: the shipped CLI's sibling list actually covers both
  // confirmed instances - a real source read, not a fixture.
  registry.define(
    /^the sandbox availability mechanism is configured with the repo-root siblings that tests and code under test reach into$/,
    () => {
      const cliSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'extension', 'scripts', 'ensureStrykerSandboxSiblings.js'),
        'utf8'
      );
      for (const sibling of Object.keys(KNOWN_SIBLING_CHECK_FILES)) {
        if (!new RegExp(`['"]${sibling}['"]`).test(cliSrc)) {
          throw new Error(`expected ensureStrykerSandboxSiblings.js's SIBLING_NAMES to include '${sibling}'`);
        }
      }
    }
  );

  // ── BL-221 stryker-pwa-sandbox-01 (pwa/-specific, unchanged text) ───
  registry.define(/^a unit test that reads pwa\/index\.html at run time$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    fs.mkdirSync(path.join(targetPath, 'pwa'), { recursive: true });
    fs.writeFileSync(path.join(targetPath, 'pwa', 'index.html'), '<html></html>');
    ctx.sibling = ctx.sibling || 'pwa';
  });

  registry.define(/^the hardener runs the Stryker mutation dry run$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    const extensionDir = path.join(targetPath, 'extension');
    const sibling = ctx.sibling || 'pwa';
    const checkFile = KNOWN_SIBLING_CHECK_FILES[sibling];
    ensureStrykerSandboxSiblingLink(extensionDir, '.stryker-tmp', sibling);
    ctx.resolvedSiblingPath = resolveFromSimulatedSandboxTestDir(extensionDir, sibling, checkFile);
  });

  registry.define(/^the dry run does not fail with ENOENT on any pwa\/ path$/, (ctx) => {
    if (!fs.existsSync(ctx.resolvedSiblingPath)) {
      throw new Error(`expected ${ctx.resolvedSiblingPath} to resolve without ENOENT`);
    }
  });

  registry.define(/^the test passes inside the sandbox as it does in a normal run$/, (ctx) => {
    const content = fs.readFileSync(ctx.resolvedSiblingPath, 'utf8');
    if (content !== '<html></html>') {
      throw new Error(`expected the sandboxed read to see the same content as a normal run, got: ${content}`);
    }
  });

  // ── BL-267 stryker-sibling-sandbox-01 (Scenario Outline, parametrized) ─
  registry.define(/^code under test that resolves the repo-root (.+) path at run time$/, (ctx, sibling) => {
    if (!(sibling in KNOWN_SIBLING_CHECK_FILES)) {
      throw new Error(`unknown sibling example value: "${sibling}" (KNOWN_SIBLING_CHECK_FILES: ${Object.keys(KNOWN_SIBLING_CHECK_FILES).join(', ')})`);
    }
    ctx.sibling = sibling;
    const targetPath = ensureTargetPath(ctx);
    const checkFile = KNOWN_SIBLING_CHECK_FILES[sibling];
    const checkFileAbsPath = path.join(targetPath, sibling, checkFile);
    fs.mkdirSync(path.dirname(checkFileAbsPath), { recursive: true });
    fs.writeFileSync(checkFileAbsPath, `fixture content for ${sibling}`);
  });

  registry.define(/^the dry run does not fail with ENOENT on the (.+) path$/, (ctx, sibling) => {
    if (sibling !== ctx.sibling) {
      throw new Error(`expected the Then step's sibling ("${sibling}") to match the scenario's Given sibling ("${ctx.sibling}")`);
    }
    if (!fs.existsSync(ctx.resolvedSiblingPath)) {
      throw new Error(`expected ${ctx.resolvedSiblingPath} to resolve without ENOENT`);
    }
  });

  registry.define(/^the (.+) path resolves inside the sandbox as it does in a normal run$/, (ctx, sibling) => {
    if (sibling !== ctx.sibling) {
      throw new Error(`expected the Then step's sibling ("${sibling}") to match the scenario's Given sibling ("${ctx.sibling}")`);
    }
    const content = fs.readFileSync(ctx.resolvedSiblingPath, 'utf8');
    if (content !== `fixture content for ${sibling}`) {
      throw new Error(`expected the sandboxed read to see the same content as a normal run, got: ${content}`);
    }
  });

  // ── BL-267 stryker-sibling-sandbox-02 (compliance battery CLI) ──────
  registry.define(
    /^mutated recruiter code shells swarmforge\/scripts\/compliance_battery\.bb via a REPO_ROOT computed three levels up from out\/recruiter\/$/,
    (ctx) => {
      const targetPath = ensureTargetPath(ctx);
      const scriptPath = path.join(targetPath, 'swarmforge', 'scripts', 'compliance_battery.bb');
      fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
      fs.writeFileSync(scriptPath, '#!/usr/bin/env bb\n');
    }
  );

  registry.define(/^the hardener runs the no-surviving-mutants gate on the recruiter files$/, (ctx) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'extension', 'package.json'), 'utf8'));
    if (!/ensureStrykerSandboxSiblings\.js.*&&.*stryker run/.test(pkg.scripts.mutation)) {
      throw new Error(`expected the mutation script to ensure the sandbox sibling links before stryker run, got: ${pkg.scripts.mutation}`);
    }
    const targetPath = ensureTargetPath(ctx);
    const extensionDir = path.join(targetPath, 'extension');
    ensureStrykerSandboxSiblingLink(extensionDir, '.stryker-tmp', 'swarmforge');
    ctx.resolvedCompliancePath = resolveFromSimulatedSandboxRecruiterDir(
      extensionDir,
      'swarmforge',
      'scripts',
      'compliance_battery.bb'
    );
  });

  registry.define(/^the run reaches mutant evaluation rather than aborting on a missing compliance_battery\.bb$/, (ctx) => {
    if (!fs.existsSync(ctx.resolvedCompliancePath)) {
      throw new Error(
        `expected the sandbox-shared swarmforge/ link to resolve compliance_battery.bb from a REPO_ROOT computed 3 levels up (would otherwise abort the dry run with ENOENT), got missing: ${ctx.resolvedCompliancePath}`
      );
    }
  });

  // ── BL-221 stryker-pwa-sandbox-02 / BL-267 shared scope steps ───────
  registry.define(/^a ticket whose changed files are scoped to out\/\*\*\/\*\.js$/, () => {
    // No fixture state needed - the mutate scope is pinned by the
    // Background's config assertion and never touched by these tickets' fixes.
  });

  registry.define(/^the hardener runs the no-surviving-mutants gate$/, (ctx) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'extension', 'package.json'), 'utf8'));
    if (!/ensureStrykerSandboxSiblings\.js.*&&.*stryker run/.test(pkg.scripts.mutation)) {
      throw new Error(`expected the mutation script to ensure the sandbox sibling links before stryker run, got: ${pkg.scripts.mutation}`);
    }
    const targetPath = ensureTargetPath(ctx);
    const extensionDir = path.join(targetPath, 'extension');
    fs.mkdirSync(path.join(targetPath, 'pwa'), { recursive: true });
    fs.writeFileSync(path.join(targetPath, 'pwa', 'marker'), 'ok');
    ensureStrykerSandboxSiblingLink(extensionDir, '.stryker-tmp', 'pwa');
    ctx.resolvedMarkerPath = resolveFromSimulatedSandboxTestDir(extensionDir, 'pwa', 'marker');
  });

  registry.define(/^the run reaches mutant evaluation rather than aborting in the dry run$/, (ctx) => {
    if (!fs.existsSync(ctx.resolvedMarkerPath)) {
      throw new Error(
        `expected the sandbox-shared pwa/ link to resolve (would otherwise abort the dry run with ENOENT), got missing: ${ctx.resolvedMarkerPath}`
      );
    }
  });

  // ── BL-267 stryker-sibling-sandbox-03 (scope regression guard) ──────
  registry.define(/^the sandbox availability mechanism makes the sibling paths available$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    const extensionDir = path.join(targetPath, 'extension');
    fs.mkdirSync(path.join(targetPath, 'pwa'), { recursive: true });
    fs.mkdirSync(path.join(targetPath, 'swarmforge'), { recursive: true });
    ctx.siblingLinkResults = ensureStrykerSandboxSiblingLinks(extensionDir, '.stryker-tmp', ['pwa', 'swarmforge']);
  });

  registry.define(/^the mutated set remains out\/\*\*\/\*\.js only$/, (ctx) => {
    if (!ctx.siblingLinkResults || ctx.siblingLinkResults.length !== 2) {
      throw new Error('expected the sibling-link mechanism to have run for both pwa and swarmforge first');
    }
    const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'extension', 'stryker.config.json'), 'utf8'));
    if (config.mutate.length !== 1 || config.mutate[0] !== 'out/**/*.js') {
      throw new Error(`expected mutate to remain exactly ['out/**/*.js'] after sibling links are made available, got: ${JSON.stringify(config.mutate)}`);
    }
  });
}

module.exports = { registerSteps };
