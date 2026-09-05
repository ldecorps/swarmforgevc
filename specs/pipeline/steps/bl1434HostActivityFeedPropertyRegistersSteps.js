'use strict';

// BL-1434: step handlers driving the REAL extension/test/hostActivityFeed.property.test.js
// through the REAL vitest.properties.config.mjs (never a fabricated
// collection result), and reading the REAL register/allowlist TSVs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1434 The host-activity-feed property registers its trials as tests';
const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_FILE = 'test/hostActivityFeed.property.test.js';
const STANDING_REDS_TSV = path.join(REPO_ROOT, 'backlog', 'standing-reds.tsv');
const ALLOWLIST_TSV = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_suite_standing_allowlist.tsv');

function runVitestJson(env) {
  try {
    const out = execFileSync(
      'npx',
      ['vitest', 'run', '--config', 'vitest.properties.config.mjs', TEST_FILE, '--reporter=json'],
      { cwd: EXTENSION_DIR, encoding: 'utf8', env: { ...process.env, ...env } }
    );
    return { status: 0, json: JSON.parse(out) };
  } catch (err) {
    // A failing vitest run exits non-zero; stdout still carries the JSON
    // report (the actual assertion failure, never a collection error, is
    // what scenario 03 needs to read).
    const out = err.stdout ? err.stdout.toString() : '';
    let json = null;
    try {
      json = JSON.parse(out);
    } catch {
      /* fall through with json: null - the caller decides what that means */
    }
    return { status: err.status, json };
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^hostActivityFeed\.property\.test\.js is collected under the properties config$/, (ctx) => {
    ctx.collectResult = runVitestJson({});
  });

  scoped(/^at least one test is registered and none is reported as no suite found$/, (ctx) => {
    const { json } = ctx.collectResult;
    if (!json) {
      throw new Error('expected a parseable JSON test report, got none - vitest likely reported a collection error');
    }
    if (json.numTotalTests < 1) {
      throw new Error(`expected at least one test registered, got numTotalTests=${json.numTotalTests}`);
    }
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the forty registered trials execute in a solo vitest run of the file$/, (ctx) => {
    ctx.soloResult = runVitestJson({});
  });

  scoped(/^every trial passes$/, (ctx) => {
    const { status, json } = ctx.soloResult;
    if (status !== 0 || !json || json.numFailedTests !== 0) {
      throw new Error(`expected a clean solo pass, got status=${status}, json=${JSON.stringify(json)}`);
    }
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a feed that returns one line nobody recorded$/, (ctx) => {
    ctx.injectInventedLine = true;
  });

  scoped(/^the property runs against that feed$/, (ctx) => {
    ctx.injectedResult = runVitestJson(ctx.injectInventedLine ? { BL1434_INJECT_INVENTED_LINE: '1' } : {});
  });

  scoped(/^it fails naming the invented line$/, (ctx) => {
    const { status, json } = ctx.injectedResult;
    if (status === 0) {
      throw new Error('expected the injected-feed run to FAIL, but it passed - the conversion turned the check into logging');
    }
    const failureMessages = (json && json.testResults || [])
      .flatMap((r) => r.assertionResults || [])
      .flatMap((a) => a.failureMessages || [])
      .join('\n');
    if (!/invented line/.test(failureMessages)) {
      throw new Error(`expected the failure to name the invented line, got: ${failureMessages || JSON.stringify(json)}`);
    }
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^backlog\/standing-reds\.tsv and the property allowlist are read at the parcel commit$/, (ctx) => {
    ctx.standingReds = fs.readFileSync(STANDING_REDS_TSV, 'utf8');
    ctx.allowlist = fs.readFileSync(ALLOWLIST_TSV, 'utf8');
  });

  scoped(/^neither names hostActivityFeed\.property\.test\.js$/, (ctx) => {
    assert.ok(!ctx.standingReds.includes('hostActivityFeed.property.test.js'), 'expected no standing-reds row for the file');
    assert.ok(!ctx.allowlist.includes('hostActivityFeed.property.test.js'), 'expected no allowlist row for the file');
  });
}

module.exports = { registerSteps };
