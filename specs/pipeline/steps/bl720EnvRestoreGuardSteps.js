'use strict';

// BL-720: step handlers driving the REAL env-restore guard module
// (extension/test/helpers/envRestoreGuard.js, plain JS - no compile step,
// test-only code) directly - never a hand-rolled reimplementation of the
// snapshot/diff/format logic the runtime guard (envRestoreGuardSetup.js)
// wraps into vitest's per-test beforeEach/afterEach via
// extension/vitest.config.mjs's setupFiles.
const fs = require('node:fs');
const path = require('node:path');

const EXTENSION_ROOT = path.join(__dirname, '..', '..', '..', 'extension');
const EXT_TEST = path.join(EXTENSION_ROOT, 'test');
const { diffEnvSnapshots, formatEnvLeakMessage } = require(path.join(EXT_TEST, 'helpers', 'envRestoreGuard'));

const TEST_KEY = 'BL720_ACCEPTANCE_TEST_KEY';
const AMBIENT_KEY = 'BL720_ACCEPTANCE_AMBIENT_KEY';
const LEAK_KEY = 'BL720_ACCEPTANCE_LEAK_KEY';

// "the suite runs" is a generic enough phrase that a future ticket could
// legitimately reuse it for unrelated behavior - registered via
// defineScoped, pinned to this exact Feature: title, so it only wins
// resolution while THIS feature is running (bl413StaleSandboxSweepSteps.js
// is the precedent for this convention).
const FEATURE_NAME = 'A test restores every process.env key it touches';

// The feature's own Scenario Outline load-bearing rule: validate the
// Examples column against explicit KNOWN_VALUES, never a bare passthrough
// (engineering.prompt's Scenario Outline rule).
const PRIOR_STATE_SETUP = {
  'holds a value': (ctx) => {
    ctx.priorValue = 'bl720-ambient-prior-value';
    process.env[ctx.testKey] = ctx.priorValue;
  },
  'is unset': (ctx) => {
    ctx.priorValue = undefined;
    delete process.env[ctx.testKey];
  },
};

const EXPECTED_AFTER_CHECK = {
  'holds that same value again': (ctx) => process.env[ctx.testKey] === ctx.priorValue,
  'is unset again': (ctx) => process.env[ctx.testKey] === undefined,
};

// The exact idiom applied at all 11 CURSOR_API_KEY call sites in
// cursorBridgeAgentSession.test.js: capture the prior value before
// mutating, then in finally either delete (if it was absent) or restore it.
function applyCaptureRestoreIdiom(key, tempValue) {
  const prevValue = process.env[key];
  process.env[key] = tempValue;
  if (prevValue === undefined) delete process.env[key];
  else process.env[key] = prevValue;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the suite runs with worker isolation off, so process\.env persists across files$/, () => {
    const configPath = path.join(EXTENSION_ROOT, 'vitest.config.mjs');
    const configText = fs.readFileSync(configPath, 'utf8');
    if (!/isolate:\s*false/.test(configText)) {
      throw new Error(`expected ${configPath} to set isolate: false (BL-445) - the whole premise of this ticket`);
    }
  });

  // ── env-restore-01 (Scenario Outline) ───────────────────────────────────
  registry.define(/^the environment key (holds a value|is unset) before the test$/, (ctx, priorState) => {
    ctx.testKey = TEST_KEY;
    const setup = PRIOR_STATE_SETUP[priorState];
    if (!setup) {
      throw new Error(`BL-720: unknown prior_state "${priorState}" - not in PRIOR_STATE_SETUP`);
    }
    setup(ctx);
  });

  registry.define(/^a test sets that key and finishes$/, (ctx) => {
    applyCaptureRestoreIdiom(ctx.testKey, 'bl720-temp-value');
  });

  registry.define(/^the key (holds that same value again|is unset again)$/, (ctx, expectedAfter) => {
    const check = EXPECTED_AFTER_CHECK[expectedAfter];
    if (!check) {
      throw new Error(`BL-720: unknown expected_after "${expectedAfter}" - not in EXPECTED_AFTER_CHECK`);
    }
    if (!check(ctx)) {
      throw new Error(`expected key ${ctx.testKey} to be "${expectedAfter}", got ${JSON.stringify(process.env[ctx.testKey])}`);
    }
  });

  // ── env-restore-02 ───────────────────────────────────────────────────
  registry.define(/^an ambient credential key is set before the suite starts$/, (ctx) => {
    ctx.ambientKey = AMBIENT_KEY;
    ctx.ambientValue = 'bl720-ambient-credential';
    process.env[ctx.ambientKey] = ctx.ambientValue;
  });

  registry.define(/^a file that mutates that key has already run in this worker$/, (ctx) => {
    applyCaptureRestoreIdiom(ctx.ambientKey, 'bl720-file-under-test-value');
  });

  registry.define(/^a later file in the same worker reads the key$/, (ctx) => {
    ctx.readValue = process.env[ctx.ambientKey];
  });

  registry.define(/^it sees the ambient credential unchanged$/, (ctx) => {
    try {
      if (ctx.readValue !== ctx.ambientValue) {
        throw new Error(`expected ambient credential ${JSON.stringify(ctx.ambientValue)}, got ${JSON.stringify(ctx.readValue)}`);
      }
    } finally {
      delete process.env[ctx.ambientKey];
    }
  });

  // ── env-restore-03 / env-restore-04 share "the suite runs" ─────────────
  // Scenario 03 has no Given, so this step simulates several well-behaved
  // files sharing this worker (BL-445 isolate:false) and collects the REAL
  // diffEnvSnapshots verdict per file, exactly as envRestoreGuardSetup.js's
  // afterEach computes it per test. Scenario 04's Given already planted an
  // unrestored leak directly in process.env (ctx.leakFile set) - "the suite
  // runs" there is a no-op; the Then step below computes that verdict.
  registry.defineScoped(
    /^the suite runs$/,
    (ctx) => {
      if (ctx.leakFile) {
        return;
      }
      const keys = ['BL720_ACCEPTANCE_SIM_A', 'BL720_ACCEPTANCE_SIM_B', 'BL720_ACCEPTANCE_SIM_C'];
      ctx.simulatedDiffs = keys.map((key) => {
        const before = { ...process.env };
        applyCaptureRestoreIdiom(key, 'bl720-simulated-value');
        const after = { ...process.env };
        return diffEnvSnapshots(before, after);
      });
    },
    FEATURE_NAME,
  );

  registry.define(/^no test file has left any process\.env key different from the value it found$/, (ctx) => {
    const leaking = ctx.simulatedDiffs.filter((diff) => diff.length > 0);
    if (leaking.length > 0) {
      throw new Error(`expected zero leaks across the simulated suite, found: ${JSON.stringify(leaking)}`);
    }
  });

  // ── env-restore-04 ───────────────────────────────────────────────────
  registry.define(/^a test file that mutates a key and does not restore it$/, (ctx) => {
    ctx.leakFile = path.join(EXT_TEST, 'fixture-leaky-file.test.js');
    ctx.leakKey = LEAK_KEY;
    delete process.env[ctx.leakKey];
    ctx.leakBefore = { ...process.env };
    process.env[ctx.leakKey] = 'bl720-leaked-value';
    // Deliberately no restore - this is the exact bug this ticket fixes.
  });

  registry.define(/^the suite fails naming that file and the leaked key$/, (ctx) => {
    try {
      const after = { ...process.env };
      const leaks = diffEnvSnapshots(ctx.leakBefore, after);
      const message = formatEnvLeakMessage(ctx.leakFile, 'fixture leaky test', leaks);
      if (leaks.length === 0 || !leaks.some((leak) => leak.key === ctx.leakKey)) {
        throw new Error(`expected a leak naming ${ctx.leakKey}, got: ${JSON.stringify(leaks)}`);
      }
      if (!message.includes(ctx.leakFile) || !message.includes(ctx.leakKey)) {
        throw new Error(`expected the failure message to name both the file and the key, got: ${message}`);
      }
    } finally {
      delete process.env[ctx.leakKey];
    }
  });
}

module.exports = { registerSteps };
