'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-886 declared invariant 3 (property authorship rests with the coder,
// first pass - BL-654): "Fixture-runner cleanup handlers are installed
// exactly once per process: repeated runAsPropertyLaneFixture calls never
// stack duplicate exit/SIGINT/SIGTERM listeners." Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs).
//
// Each property run spawns a FRESH, isolated Node child process - never
// asserts against the current Vitest worker's own process.listenerCount,
// which other setup files/Vitest internals may also touch. Call count is
// drawn from 1..15 - deliberately past Node's default maxListeners of 10,
// so a broken install-once guard would both leave listenerCount > 1 AND
// emit a real MaxListenersExceededWarning, giving both assertions genuine
// teeth (the acceptance scenario's literal "twice" wording never reaches
// past 2 calls, which cannot trip the warning at all - this property test
// is the one that actually forces that state). Each call passes
// source=42 (not a string) so fs.writeFileSync throws immediately, before
// any real vitest subprocess spawns - this keeps every property run fast
// while still exercising the exact call path (trackFixturePath ->
// installAbnormalExitHandlersOnce) that installs the listeners under
// review.
//
// Non-vacuity proven by hand at authoring time: with
// installAbnormalExitHandlersOnce's `if (abnormalExitHandlersInstalled)
// return;` guard removed, this property failed on every generated
// callCount >= 2 (listenerCount === callCount instead of 1). Restored
// before this commit.

const RUNNER_MODULE = path.join(__dirname, 'helpers', 'propertyLaneFixtureRunner.js');

function childSource() {
  return [
    "'use strict';",
    'const fs = require("node:fs");',
    'const [, , runnerPath, callCountRaw, resultFile] = process.argv;',
    'const callCount = Number(callCountRaw);',
    'const { runAsPropertyLaneFixture } = require(runnerPath);',
    'let caught = 0;',
    'for (let i = 0; i < callCount; i++) {',
    '  try {',
    '    runAsPropertyLaneFixture(42, {});',
    '  } catch (e) {',
    '    if (e.code === "ERR_INVALID_ARG_TYPE") caught++;',
    '  }',
    '}',
    'let maxListenersWarning = null;',
    'process.on("warning", (w) => {',
    '  if (w.name === "MaxListenersExceededWarning") maxListenersWarning = w.message;',
    '});',
    'const result = {',
    '  callsCaught: caught,',
    '  exitListenerCount: process.listenerCount("exit"),',
    '  sigintListenerCount: process.listenerCount("SIGINT"),',
    '  sigtermListenerCount: process.listenerCount("SIGTERM"),',
    '  maxListenersWarning,',
    '};',
    'fs.writeFileSync(resultFile, JSON.stringify(result));',
    '',
  ].join('\n');
}

function runChild(callCount) {
  const scratchDir = mkTmpDir('bl886-listener-guard-prop-');
  const resultFile = path.join(scratchDir, 'result.json');
  const childScript = path.join(scratchDir, 'child.js');
  fs.writeFileSync(childScript, childSource());
  try {
    const res = spawnSync(process.execPath, [childScript, RUNNER_MODULE, String(callCount), resultFile], { encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(`child failed (status ${res.status}): ${res.stderr}`);
    }
    return JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

test('property (BL-886 invariant 3): repeated runAsPropertyLaneFixture calls never stack duplicate exit/SIGINT/SIGTERM listeners', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 15 }), (callCount) => {
      const result = runChild(callCount);
      assert.equal(result.callsCaught, callCount, `expected all ${callCount} calls to throw ERR_INVALID_ARG_TYPE`);
      assert.equal(result.exitListenerCount, 1, `expected exactly 1 'exit' listener after ${callCount} calls, got ${result.exitListenerCount}`);
      assert.equal(result.sigintListenerCount, 1, `expected exactly 1 SIGINT listener after ${callCount} calls, got ${result.sigintListenerCount}`);
      assert.equal(result.sigtermListenerCount, 1, `expected exactly 1 SIGTERM listener after ${callCount} calls, got ${result.sigtermListenerCount}`);
      assert.equal(result.maxListenersWarning, null, `unexpected MaxListenersExceededWarning after ${callCount} calls: ${result.maxListenersWarning}`);
    }),
    { numRuns: 20 }
  );
});
