'use strict';

// BL-945: step handlers for "A document the constitution cites as authority
// exists on main". Drives the real
// specs/pipeline/steps/lib/constitutionDocCitations.js scan - never a
// reimplementation of the citation extraction or resolution check.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach } = require('node:test');
const { findUnresolvedCitations } = require('./lib/constitutionDocCitations');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_ARTICLES_DIR = path.join(REPO_ROOT, 'swarmforge', 'constitution', 'articles');

const FEATURE = 'A document the constitution cites as authority exists on main';

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedRoots.push(root);
  return root;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the constitution articles tracked on main$/,
    (ctx) => {
      ctx.articlesDir = REAL_ARTICLES_DIR;
      ctx.repoRoot = REPO_ROOT;
    },
    FEATURE
  );

  // ── Scenario 01 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the article files are scanned for cited document paths$/,
    (ctx) => {
      ctx.unresolved = findUnresolvedCitations(ctx.articlesDir, ctx.repoRoot);
    },
    FEATURE
  );

  registry.defineScoped(
    /^every cited path exists on main$/,
    (ctx) => {
      assert.deepEqual(
        ctx.unresolved,
        [],
        `expected zero dangling doc citations, found:\n${ctx.unresolved
          .map((u) => `${u.file}: ${u.citation}`)
          .join('\n')}`
      );
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^an article citing a document present on a branch but absent from main$/,
    (ctx) => {
      const root = mkTmp('sfvc-bl945-');
      ctx.fixtureArticlesDir = root;
      ctx.fixtureRepoRoot = root;
      ctx.citingFile = 'local-engineering.prompt';
      ctx.citedPath = 'docs/branding/icon-system.md';
      fs.writeFileSync(
        path.join(root, ctx.citingFile),
        `Architecture Rule 6 cites \`${ctx.citedPath}\` as authority.\n`
      );
      // Deliberately no docs/branding/icon-system.md under this fixture
      // root - it exists only "on a branch" from this fixture's own
      // perspective, matching the scenario's premise.
    },
    FEATURE
  );

  registry.defineScoped(
    /^the citation check runs$/,
    (ctx) => {
      ctx.unresolved = findUnresolvedCitations(ctx.fixtureArticlesDir, ctx.fixtureRepoRoot);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the check fails$/,
    (ctx) => {
      assert.ok(ctx.unresolved.length > 0, 'expected at least one unresolved citation');
    },
    FEATURE
  );

  registry.defineScoped(
    /^it names the citing article and the unresolved path$/,
    (ctx) => {
      const hit = ctx.unresolved.find(
        (u) => u.file === ctx.citingFile && u.citation === ctx.citedPath
      );
      assert.ok(
        hit,
        `expected an unresolved entry naming ${ctx.citingFile} and ${ctx.citedPath}, got: ${JSON.stringify(ctx.unresolved)}`
      );
    },
    FEATURE
  );

  // ── Scenario 03 (Outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^an article citing "([^"]*)"$/,
    (ctx, citation) => {
      const root = mkTmp('sfvc-bl945-');
      ctx.fixtureArticlesDir = root;
      ctx.fixtureRepoRoot = root;
      fs.writeFileSync(path.join(root, 'local-engineering.prompt'), `See \`${citation}\`.\n`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the check does not report it$/,
    (ctx) => {
      assert.deepEqual(ctx.unresolved, []);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
