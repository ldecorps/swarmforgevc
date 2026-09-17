'use strict';

// BL-1582: step handlers for "Onboarder operational how-to". Reads the REAL
// docs/how-to/BL-1582-onboarder-run-an-onboarding-end-to-end.md and the
// source files it quotes straight off disk (bl441AnsweringOfflineRunbookSteps.js's
// own convention for a docs-only ticket: a plain content check, no compiled
// module involved). Scenario 02 resolves every backticked repo-relative
// path in the page against the repo root; scenario 03 reads the literal out
// of the named source file and asserts the page carries it.

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PAGE_PATH = path.join(REPO_ROOT, 'docs', 'how-to', 'BL-1582-onboarder-run-an-onboarding-end-to-end.md');
const INDEX_PATH = path.join(REPO_ROOT, 'docs', 'index.md');

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(
    /^the Onboarder how-to page docs\/how-to\/BL-1582-onboarder-run-an-onboarding-end-to-end\.md$/,
    (ctx) => {
      ctx.page = fs.readFileSync(PAGE_PATH, 'utf8');
    }
  );

  // ── Scenario 01: reachable from the docs index ───────────────────────
  registry.define(/^the docs index is read$/, (ctx) => {
    ctx.index = fs.readFileSync(INDEX_PATH, 'utf8');
  });

  registry.define(/^the how-to guides section links the page$/, (ctx) => {
    assert.match(
      ctx.index,
      /how-to\/BL-1582-onboarder-run-an-onboarding-end-to-end\.md/,
      'expected docs/index.md to link the BL-1582 how-to page'
    );
  });

  // ── Scenario 02: every backticked repo path resolves ─────────────────
  registry.define(/^every backticked repo-relative path in the page is collected$/, (ctx) => {
    const matches = [...ctx.page.matchAll(/`([a-zA-Z0-9_.\/-]+\.[a-zA-Z]+)`/g)];
    const seen = new Set();
    ctx.paths = [];
    for (const m of matches) {
      const p = m[1];
      // Only repo-relative paths (contain a slash, no leading slash) -
      // excludes bare filenames like `onboarder-supervisor.pid` (scenario 03's
      // own concern) and env var names.
      if (p.includes('/') && !p.startsWith('/') && !seen.has(p)) {
        seen.add(p);
        ctx.paths.push(p);
      }
    }
  });

  registry.define(/^each of them resolves to a file in the repository$/, (ctx) => {
    for (const p of ctx.paths) {
      const full = path.join(REPO_ROOT, p);
      assert.ok(fs.existsSync(full), `backticked path does not resolve to a file: ${p}`);
    }
  });

  registry.define(/^the collection holds at least (\d+) paths$/, (ctx, min) => {
    assert.ok(
      ctx.paths.length >= Number(min),
      `expected at least ${min} backticked repo-relative paths, found ${ctx.paths.length}: ${JSON.stringify(ctx.paths)}`
    );
  });

  registry.define(/^the collection includes (.+)$/, (ctx, examplePath) => {
    assert.ok(
      ctx.paths.includes(examplePath),
      `expected the collection to include ${examplePath}, got: ${JSON.stringify(ctx.paths)}`
    );
  });

  // ── Scenario 03: runtime file names match the code that spells them ──
  registry.define(/^the page is read$/, () => {
    // ctx.page is already set by the Background step above.
  });

  registry.define(/^it quotes the runtime file (.+)$/, (ctx, file) => {
    assert.ok(ctx.page.includes(file), `expected the page to quote the runtime file: ${file}`);
    ctx.lastRuntimeFile = file;
  });

  registry.define(/^the source (.+) spells the same literal$/, (ctx, source) => {
    const sourceText = fs.readFileSync(path.join(REPO_ROOT, source), 'utf8');
    assert.ok(
      sourceText.includes(ctx.lastRuntimeFile),
      `expected ${source} to spell the literal "${ctx.lastRuntimeFile}"`
    );
  });

  // ── Scenario 04: every phase and prerequisite step is named ──────────
  registry.define(/^it names the phase (.+)$/, (ctx, name) => {
    assert.match(
      ctx.page,
      new RegExp(`\`${name}\`|\\b${name}\\b`),
      `expected the page to name the phase: ${name}`
    );
  });

  registry.define(/^it names the prerequisite step (.+)$/, (ctx, name) => {
    assert.match(
      ctx.page,
      new RegExp(`\`${name}\`|\\b${name}\\b`),
      `expected the page to name the prerequisite step: ${name}`
    );
  });

  // ── Scenario 05: hands the launch to the human ────────────────────────
  registry.define(/^it states that the human runs the posted launch command on the target host$/, (ctx) => {
    assert.match(
      ctx.page,
      /human runs that command themselves|you run this/i,
      'expected the page to state the human runs the posted launch command'
    );
  });

  registry.define(/^it states that the Onboarder never launches or observes the target swarm$/, (ctx) => {
    assert.match(
      ctx.page,
      /never launches? or observes? the target/i,
      'expected the page to state the Onboarder never launches or observes the target swarm'
    );
  });
}

module.exports = { registerSteps };
