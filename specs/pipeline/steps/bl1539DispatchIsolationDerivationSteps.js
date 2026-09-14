'use strict';

// BL-1539: step handlers for "the dispatch-isolation guard derives every
// self-rooting dispatcher". Drives the REAL guard script
// (test_shell_fixture_dispatch_isolation.sh) - no reimplementation of its
// derivation regex or pipeline here, so this file cannot drift from what the
// guard actually does (the IR-DRY trap the ticket's own notes warn about).
//
// "The derived set" in every scenario below is the guard's step-1 output
// (self_rooting_scripts(), read via `bash -x`'s trace of the FIRST
// `SELF_ROOTING=` assignment) - the same read the ticket's own census used
// (backlog/evidence/BL-1538-BL-1541-specifier-unowned-red-census-20260911.md
// §2) and the same the qa_e2e_procedure names. Step 1b's transitive closure
// runs after that point and is out of this ticket's scope.
//
// The guard-invocation helpers (deriveSelfRooting, synthScriptsDir) live in
// lib/bl1539SelfRootingDerivationLib.js, shared with this ticket's declared-
// invariant property test - one implementation, not two that can drift.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  REPO_ROOT,
  REAL_SCRIPTS_DIR,
  GUARD_NAME,
  deriveSelfRooting,
  synthScriptsDir,
} = require('./lib/bl1539SelfRootingDerivationLib');

const FEATURE = 'BL-1539 The dispatch-isolation guard derives every self-rooting dispatcher';

// Scenario Outline values are validated against an explicit KNOWN_VALUES
// table and throw on anything else - never a passthrough.
const KNOWN_DIRS = {
  'swarmforge/scripts': REAL_SCRIPTS_DIR,
};
const KNOWN_DISPATCHERS = ['ready_for_next.bb', 'done_with_current.bb'];

function requireKnownDispatcher(name) {
  if (!KNOWN_DISPATCHERS.includes(name)) {
    throw new Error(`unknown <dispatcher>: "${name}" - known: ${KNOWN_DISPATCHERS.join(' | ')}`);
  }
  return name;
}

function copyRealScript(name, destDir) {
  fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, name), path.join(destDir, name));
}

function writeOffendingTest(sandboxDir, dispatcher, testName) {
  const source = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    `H_VAR="$SCRIPT_DIR/../${dispatcher}"`,
    'WT="$(mktemp -d)"',
    '(cd "$WT" && SWARMFORGE_ROLE=coder bb "$H_VAR")',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(sandboxDir, 'test', testName), source);
}

function runGuard(sandboxDir) {
  return spawnSync('bash', [path.join(sandboxDir, 'test', GUARD_NAME)], { encoding: 'utf8' });
}

function disposeSandbox(ctx, sandboxDir) {
  ctx.__disposables = ctx.__disposables || [];
  ctx.__disposables.push(() => fs.rmSync(sandboxDir, { recursive: true, force: true }));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^the guard "([^"]+)" which derives the self-rooting scripts of a scripts dir$/, (ctx, guardRel) => {
    const guardPath = path.join(REPO_ROOT, guardRel);
    assert.ok(fs.existsSync(guardPath), `guard not found on disk: ${guardPath}`);
    ctx.guardPath = guardPath;
  });

  // ── Scenarios 01 / 02: derivation over the real scripts dir ───────────
  scoped(/^the guard derives the self-rooting scripts of "([^"]+)"$/, (ctx, dirLabel) => {
    if (!(dirLabel in KNOWN_DIRS)) {
      throw new Error(`unknown <dir>: "${dirLabel}" - known: ${Object.keys(KNOWN_DIRS).join(' | ')}`);
    }
    ctx.derived = deriveSelfRooting(ctx.guardPath);
  });

  scoped(/^the derived set contains "([^"]+)"$/, (ctx, dispatcher) => {
    requireKnownDispatcher(dispatcher);
    assert.ok(
      ctx.derived.includes(dispatcher),
      `expected "${dispatcher}" in the derived set (${ctx.derived.length} entries), got:\n${ctx.derived.join('\n')}`
    );
  });

  scoped(/^the derived set holds at least (\d+) scripts$/, (ctx, nStr) => {
    const n = Number(nStr);
    assert.ok(
      ctx.derived.length >= n,
      `expected at least ${n} self-rooting scripts, got ${ctx.derived.length}:\n${ctx.derived.join('\n')}`
    );
  });

  // ── Scenario 03: a test executing a dispatcher through the real dir ────
  scoped(/^a sandbox scripts dir holding the real "([^"]+)" and the guard$/, (ctx, dispatcher) => {
    requireKnownDispatcher(dispatcher);
    ctx.sandbox = synthScriptsDir('bl1539-sandbox-offend-');
    copyRealScript(dispatcher, ctx.sandbox);
    ctx.dispatcher = dispatcher;
    disposeSandbox(ctx, ctx.sandbox);
  });

  scoped(/^a shell test in that sandbox that binds "\$SCRIPT_DIR\/\.\.\/([^"]+)" to a variable and executes it$/, (ctx, dispatcher) => {
    requireKnownDispatcher(dispatcher);
    assert.equal(
      dispatcher,
      ctx.dispatcher,
      `feature text names "${dispatcher}" but the sandbox was built for "${ctx.dispatcher}"`
    );
    ctx.offenderName = `test_bl1539_generated_offender_${dispatcher.replace(/[^a-z0-9]/gi, '_')}.sh`;
    writeOffendingTest(ctx.sandbox, dispatcher, ctx.offenderName);
  });

  scoped(/^the guard runs in that sandbox$/, (ctx) => {
    ctx.result = runGuard(ctx.sandbox);
  });

  scoped(/^the guard exits non-zero and names that shell test$/, (ctx) => {
    assert.notEqual(ctx.result.status, 0, `expected the guard to fail, got:\n${ctx.result.stdout}${ctx.result.stderr}`);
    const out = `${ctx.result.stdout}${ctx.result.stderr}`;
    assert.ok(out.includes(ctx.offenderName), `expected the failure to NAME "${ctx.offenderName}", got:\n${out}`);
  });

  // ── Scenario 04: verdict on a large self-rooting file is stable ────────
  scoped(/^a sandbox scripts dir holding only the real "([^"]+)"$/, (ctx, dispatcher) => {
    requireKnownDispatcher(dispatcher);
    ctx.sandbox = synthScriptsDir('bl1539-sandbox-solo-');
    copyRealScript(dispatcher, ctx.sandbox);
    disposeSandbox(ctx, ctx.sandbox);
  });

  scoped(/^the guard derives the self-rooting scripts of that sandbox (\d+) times$/, (ctx, nStr) => {
    const n = Number(nStr);
    const guardPath = path.join(ctx.sandbox, 'test', GUARD_NAME);
    ctx.derivedRuns = [];
    for (let i = 0; i < n; i += 1) {
      ctx.derivedRuns.push(deriveSelfRooting(guardPath));
    }
  });

  scoped(/^"([^"]+)" is in the derived set every time$/, (ctx, name) => {
    requireKnownDispatcher(name);
    const missingAt = ctx.derivedRuns.map((set, i) => (set.includes(name) ? null : i)).filter((i) => i !== null);
    assert.equal(
      missingAt.length,
      0,
      `"${name}" missing from ${missingAt.length}/${ctx.derivedRuns.length} runs (indices: ${missingAt.join(', ')})`
    );
  });

  // ── Scenario 05: the standing property runner is green ─────────────────
  scoped(/^the standing suite runs "([^"]+)"$/, (ctx, relPath) => {
    const runnerPath = path.join(REPO_ROOT, relPath);
    assert.ok(fs.existsSync(runnerPath), `runner not found on disk: ${runnerPath}`);
    ctx.runnerResult = spawnSync('bb', [runnerPath], { encoding: 'utf8', cwd: REPO_ROOT });
  });

  scoped(/^the run exits zero and reports no failed property check$/, (ctx) => {
    const out = `${ctx.runnerResult.stdout}${ctx.runnerResult.stderr}`;
    assert.equal(ctx.runnerResult.status, 0, `expected exit 0, got:\n${out}`);
    assert.ok(!/FAIL /.test(out), `expected no failed property check, got:\n${out}`);
  });
}

module.exports = { registerSteps };
