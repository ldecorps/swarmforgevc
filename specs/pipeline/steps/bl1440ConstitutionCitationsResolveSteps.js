'use strict';

// BL-1440: step handlers for "every docs path a constitution article cites
// resolves on disk". Scenarios 01-02 read the parcel's own live tree
// (justified by the feature's own header: the constitution and docs at
// this commit are the contract). Scenario 03 drives the REAL commit guard
// (swarmforge/scripts/check_constitution_doc_citations.sh) against a
// fixture git repository - never a reimplementation of the guard.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-1440 Every docs path a constitution article cites resolves on disk';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ARTICLES_DIR = path.join(REPO_ROOT, 'swarmforge', 'constitution', 'articles');
const GUARD_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_constitution_doc_citations.sh');
const RESOLVER_JS = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'constitutionDocCitations.js');

const { findUnresolvedCitations } = require(RESOLVER_JS);

const KNOWN_OUTCOMES = new Set(['refuses', 'passes']);

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function initFixtureRepo() {
  const root = mkTmpDir('bl1440-fixture-');
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
  // The guard resolves its own resolver at a repo-relative path - copy the
  // real one in, never a fixture reimplementation (BL-1390: proven via
  // rev-parse --git-common-dir before any mutating git command, which the
  // `git init` above already establishes as this fixture's own root).
  const resolverDest = path.join(root, 'specs', 'pipeline', 'steps', 'lib', 'constitutionDocCitations.js');
  fs.mkdirSync(path.dirname(resolverDest), { recursive: true });
  fs.copyFileSync(RESOLVER_JS, resolverDest);
  fs.mkdirSync(path.join(root, 'docs', 'how-to'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'how-to', 'present.md'), 'exists\n');
  return root;
}

function runGuard(root) {
  return spawnSync(GUARD_SH, [], { cwd: root, encoding: 'utf8' });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^every constitution article at the parcel commit is scanned for docs paths$/, (ctx) => {
    ctx.unresolved = findUnresolvedCitations(ARTICLES_DIR, REPO_ROOT);
  });

  scoped(/^no cited path is unresolved$/, (ctx) => {
    assert.deepEqual(ctx.unresolved, [],
      `expected zero dangling citations, got: ${JSON.stringify(ctx.unresolved)}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^docs\/deprecated\/ and docs\/index\.md are read at the parcel commit$/, (ctx) => {
    ctx.deprecatedDir = path.join(REPO_ROOT, 'docs', 'deprecated');
    ctx.deprecatedIndex = path.join(ctx.deprecatedDir, 'README.md');
    ctx.docsIndex = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'index.md'), 'utf8');
  });

  scoped(/^the directory holds an index page stating how a page arrives there$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.deprecatedDir), 'expected docs/deprecated/ to exist');
    assert.ok(fs.existsSync(ctx.deprecatedIndex), 'expected docs/deprecated/README.md to exist');
    const text = fs.readFileSync(ctx.deprecatedIndex, 'utf8');
    assert.ok(/documenter|deprecat/i.test(text), 'expected the index to state how a page arrives here');
  });

  scoped(/^docs\/index\.md links that index page$/, (ctx) => {
    assert.ok(ctx.docsIndex.includes('deprecated/README.md'),
      `expected docs/index.md to link deprecated/README.md, got no match in:\n${ctx.docsIndex}`);
  });

  // ── Scenario 03 (Outline) ─────────────────────────────────────────────
  scoped(/^a fixture repository whose constitution article cites (.+)$/, (ctx, citedPath) => {
    ctx.root = initFixtureRepo();
    const articlesDir = path.join(ctx.root, 'swarmforge', 'constitution', 'articles');
    fs.mkdirSync(articlesDir, { recursive: true });
    fs.writeFileSync(path.join(articlesDir, 'test-article.md'), `See \`${citedPath}\` for details.\n`);
    git(ctx.root, 'add', '-A');
  });

  scoped(/^the constitution citation commit guard runs over that repository$/, (ctx) => {
    ctx.result = runGuard(ctx.root);
  });

  scoped(/^the guard (refuses|passes) naming (.+)$/, (ctx, outcome, citedPath) => {
    if (!KNOWN_OUTCOMES.has(outcome)) {
      throw new Error(`unknown <outcome>: ${outcome}`);
    }
    try {
      if (outcome === 'refuses') {
        assert.notEqual(ctx.result.status, 0, `expected the guard to refuse, got exit ${ctx.result.status}: ${ctx.result.stdout}${ctx.result.stderr}`);
        assert.ok(ctx.result.stderr.includes(citedPath),
          `expected the refusal to name ${citedPath}, got: ${ctx.result.stderr}`);
      } else {
        assert.equal(ctx.result.status, 0, `expected the guard to pass, got exit ${ctx.result.status}: ${ctx.result.stdout}${ctx.result.stderr}`);
      }
    } finally {
      // Removed in a finally, never only after the last assertion - a
      // failing assertion above must not leak the fixture directory.
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
