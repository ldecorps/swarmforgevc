'use strict';

// BL-225: step handlers for the neutralize-webhook-secret-test-fixtures
// feature. Drives real `git grep` over the tracked tree and the real
// extension test files - no fixture reimplementation.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EVIDENCE_DOC = path.join(REPO_ROOT, 'backlog', 'evidence', 'BL-217-inbound-email-webhook-bounce-20260709.md');
const WHSEC_PATTERN = 'whsec_[A-Za-z0-9+/]{20,}';

function gitGrepWhsecLiterals() {
  try {
    return execFileSync('git', ['grep', '-nE', WHSEC_PATTERN], { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch (err) {
    if (err.status === 1) {
      return ''; // git grep's own "ran fine, no match" exit code
    }
    throw err;
  }
}

function registerSteps(registry) {
  // ── no-literal-secret-01 ─────────────────────────────────────────────
  registry.define(/^the repository working tree$/, () => {
    // Non-behavioral - nothing to fixture, the real tree is scanned as-is.
  });

  registry.define(/^it is scanned for a webhook signing-secret literal \(a "whsec_" prefix directly followed by a long base64 token\)$/, (ctx) => {
    ctx.whsecMatches = gitGrepWhsecLiterals();
  });

  registry.define(/^no tracked file contains one$/, (ctx) => {
    if (ctx.whsecMatches) {
      throw new Error(`expected zero whsec_ high-entropy literals in the tracked tree, found:\n${ctx.whsecMatches}`);
    }
  });

  // ── tests-still-verify-02 ────────────────────────────────────────────
  registry.define(/^the signature tests build their fixture secret at runtime from an obviously-fake seed$/, () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'extension', 'test', 'svixSignature.test.js'), 'utf8');
    if (!/const SECRET = 'whsec_' \+ Buffer\.from\(/.test(src)) {
      throw new Error('expected svixSignature.test.js\'s SECRET to be built at runtime from a seed, not a committed literal');
    }
  });

  registry.define(/^the test suite runs$/, (ctx) => {
    // vitest, not node --test: the extension suite runs under vitest (BL-124)
    // and node --test run() cannot be invoked recursively from within this
    // very acceptance run's own node:test process (it silently skips).
    const extensionDir = path.join(REPO_ROOT, 'extension');
    const vitestBin = path.join(extensionDir, 'node_modules', '.bin', 'vitest');
    ctx.testResult = execFileSync(
      vitestBin,
      ['run', 'test/svixSignature.test.js', 'test/recertInboundWebhook.test.js'],
      { cwd: extensionDir, encoding: 'utf8' }
    );
  });

  registry.define(/^the signature accept and reject tests pass exactly as before$/, (ctx) => {
    if (!/Test Files\s+\d+ passed/.test(ctx.testResult) || /\d+ failed/.test(ctx.testResult)) {
      throw new Error(`expected the signature test suite to pass cleanly; got:\n${ctx.testResult}`);
    }
  });

  // ── evidence-redacted-03 ─────────────────────────────────────────────
  registry.define(/^the BL-217 inbound-webhook bounce evidence document$/, (ctx) => {
    ctx.evidenceDoc = fs.readFileSync(EVIDENCE_DOC, 'utf8');
  });

  registry.define(/^its reproduction snippet builds the secret at runtime or shows a redacted placeholder, never a whsec_ literal$/, (ctx) => {
    if (/whsec_[A-Za-z0-9+/]{20,}/.test(ctx.evidenceDoc)) {
      throw new Error('expected the evidence doc to no longer embed the whsec_ literal');
    }
    if (!/Buffer\.from\(/.test(ctx.evidenceDoc)) {
      throw new Error('expected the evidence doc\'s reproduction snippet to build the secret at runtime (or show a redacted placeholder)');
    }
  });
}

module.exports = { registerSteps };
