'use strict';

// BL-1601: step handlers for "The redeploy tests wait for their detached
// script and the tmpDir sweep survives a racing writer". Drives the REAL
// extension/test/helpers/tmpDir.js (mkTmpDir, sweepPendingTmpDirs) and a
// REAL detached spawn (the same shape the redeploy modules use), never a
// reimplementation of either - the defect is a real race between a real
// child process and a real recursive rmSync.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const FEATURE = 'BL-1601 The redeploy tests wait for their detached script and the tmpDir sweep survives a racing writer';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TMPDIR_HELPER = path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'tmpDir.js');
const TEST_FILE = path.join(REPO_ROOT, 'extension', 'test', 'telegramCursorOperatorExec.test.js');

function freshTmpDirHelper() {
  // Each scenario gets its OWN module instance (never the shared require
  // cache) - sweepPendingTmpDirs' `pending` list is module-level state, and
  // scenarios must not see each other's registered roots.
  delete require.cache[require.resolve(TMPDIR_HELPER)];
  return require(TMPDIR_HELPER);
}

function waitForFileSync(filePath, boundMs, stepMs) {
  const attempts = Math.ceil(boundMs / stepMs);
  for (let i = 0; i < attempts && !fs.existsSync(filePath); i += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stepMs);
  }
}

function ensure(ctx) {
  if (!ctx.bl1601) ctx.bl1601 = {};
  return ctx.bl1601;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(
    /^a fixture root and a stub script that sleeps 300 ms and then writes a marker into that root$/,
    (ctx) => {
      const state = ensure(ctx);
      state.tmpDir = freshTmpDirHelper();
      state.root = state.tmpDir.mkTmpDir('bl1601-scenario01-');
      state.marker = path.join(state.root, 'marker');
      const script = path.join(state.root, 'writer.sh');
      fs.writeFileSync(script, `#!/usr/bin/env bash\nsleep 0.3\necho ok > "${state.marker}"\n`, 'utf8');
      fs.chmodSync(script, 0o755);
      state.script = script;
    }
  );

  scoped(
    /^the script is spawned detached the way the redeploy modules spawn it and the test waits for the marker with a 2000 ms bound$/,
    (ctx) => {
      const state = ensure(ctx);
      const child = spawn('bash', [state.script], { detached: true, stdio: 'ignore' });
      child.unref();
      waitForFileSync(state.marker, 2000, 20);
    }
  );

  scoped(/^the marker exists before the wait returns$/, (ctx) => {
    const state = ensure(ctx);
    assert.ok(fs.existsSync(state.marker), 'expected the marker to exist once the wait returns');
  });

  scoped(/^the pending tmpDir sweep removes the root without error$/, (ctx) => {
    const state = ensure(ctx);
    assert.doesNotThrow(() => state.tmpDir.sweepPendingTmpDirs());
    assert.equal(fs.existsSync(state.root), false, 'expected the sweep to have removed the root');
  });

  // ── Scenario Outline 02 ─────────────────────────────────────────────
  scoped(
    /^a pending tmpDir root whose removal (fails ENOTEMPTY twice and then succeeds|fails ENOTEMPTY on every attempt|succeeds on the first attempt)$/,
    (ctx, behaviour) => {
      const state = ensure(ctx);
      state.tmpDir = freshTmpDirHelper();
      state.root = state.tmpDir.mkTmpDir('bl1601-scenario02-');
      let calls = 0;
      const enotempty = () => {
        const err = new Error('ENOTEMPTY: directory not empty');
        err.code = 'ENOTEMPTY';
        throw err;
      };
      state.rmFn = (target) => {
        calls += 1;
        state.calls = calls;
        if (behaviour === 'fails ENOTEMPTY twice and then succeeds' && calls <= 2) {
          enotempty();
        } else if (behaviour === 'fails ENOTEMPTY on every attempt') {
          enotempty();
        }
        // "succeeds on the first attempt" and the post-2-failures success
        // path both fall through to a REAL removal, so the root is
        // genuinely gone afterward - never simulated.
        fs.rmSync(target, { recursive: true, force: true });
      };
      state.behaviour = behaviour;
    }
  );

  scoped(/^the pending tmpDir sweep runs$/, (ctx) => {
    const state = ensure(ctx);
    try {
      state.result = { swept: state.tmpDir.sweepPendingTmpDirs(state.rmFn), threw: null };
    } catch (err) {
      state.result = { swept: null, threw: err };
      // The permanent-failure case never actually removes the real
      // directory mkTmpDir created - clean it up so this scenario leaks
      // nothing (never a real assertion, just this fixture's own hygiene).
      fs.rmSync(state.root, { recursive: true, force: true });
    }
  });

  scoped(/^the sweep returns the root removed, after (\d+) attempts?$/, (ctx, expectedAttempts) => {
    const state = ensure(ctx);
    assert.equal(state.result.threw, null, `expected no throw, got: ${state.result.threw}`);
    assert.deepEqual(state.result.swept, [state.root]);
    assert.equal(state.calls, Number(expectedAttempts), `expected exactly ${expectedAttempts} rmFn call(s), got ${state.calls}`);
  });

  scoped(/^the sweep rethrows ENOTEMPTY after its bounded attempts$/, (ctx) => {
    const state = ensure(ctx);
    assert.ok(state.result.threw, 'expected the sweep to throw');
    assert.equal(state.result.threw.code, 'ENOTEMPTY');
    assert.equal(state.calls, state.tmpDir.REMOVE_RETRY_ATTEMPTS, `expected exactly ${state.tmpDir.REMOVE_RETRY_ATTEMPTS} bounded attempts, got ${state.calls}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the source of extension\/test\/telegramCursorOperatorExec\.test\.js is read$/, (ctx) => {
    const state = ensure(ctx);
    state.source = fs.readFileSync(TEST_FILE, 'utf8');
  });

  const MARKER_WAIT_LOOP = 'for (let i = 0; i < 100 && !fs.existsSync(marker); i += 1) {';
  const MARKER_ASSERTION = 'assert.ok(fs.existsSync(marker)';

  scoped(/^exactly 2 tests in it spawn a redeploy script through executeOperatorVerb$/, (ctx) => {
    const state = ensure(ctx);
    const waitCount = state.source.split(MARKER_WAIT_LOOP).length - 1;
    assert.equal(waitCount, 2, `expected exactly 2 tests with the marker-wait loop, got ${waitCount}`);
  });

  scoped(/^each of those 2 tests waits for its marker and asserts it exists before the test returns$/, (ctx) => {
    const state = ensure(ctx);
    const assertCount = state.source.split(MARKER_ASSERTION).length - 1;
    assert.equal(assertCount, 2, `expected exactly 2 marker existence assertions, got ${assertCount}`);
  });
}

module.exports = { registerSteps };
