'use strict';

// BL-1983: step handlers for "the work ratchet does not refuse a run
// measured under host load". Scenario 01 drives the REAL
// classifySuiteWork/decideSuiteWorkExit/formatSuiteWorkVerdict against the
// scenario's own numbers - no hand-copied arithmetic. Scenario 02 drives
// the REAL buildRecord (testDurationRecorderLib.js).

const assert = require('node:assert/strict');
const {
  classifySuiteWork,
  buildSuiteWorkVerdict,
  decideSuiteWorkExit,
  formatSuiteWorkVerdict,
} = require('../../../extension/out/tools/check-suite-duration-budget');
const { buildRecord } = require('../../../extension/scripts/testDurationRecorderLib');

const FEATURE = 'BL-1983 The work ratchet does not refuse a run measured under host load';

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Scenario 01 (Outline) ─────────────────────────────────────────────
  scoped(
    /^a recorded run with summed per-file work (\d+) ms on a host with 20 logical cores at a 5-minute load average of ([\d.]+)$/,
    (ctx, work, load) => {
      ctx.bl1983 = { workMs: Number(work), cores: 20, loadAvg5: Number(load) };
    }
  );

  scoped(/^the work ratchet decides its exit code$/, (ctx) => {
    const st = ctx.bl1983;
    const verdictResult = buildSuiteWorkVerdict(st.workMs, 1, 0);
    st.verdict = verdictResult.verdict;
    assert.equal(st.verdict, classifySuiteWork(st.workMs));
    st.decision = decideSuiteWorkExit(st.verdict, st.loadAvg5, st.cores);
    st.line = formatSuiteWorkVerdict(verdictResult, st.loadAvg5, st.cores);
  });

  scoped(/^the exit code is (\S+)$/, (ctx, exit) => {
    const { decision } = ctx.bl1983;
    if (exit === 'non-zero') {
      assert.equal(decision.exitCode, 1, `expected a non-zero exit, got ${decision.exitCode}`);
    } else {
      assert.equal(decision.exitCode, Number(exit));
    }
  });

  scoped(/^the printed work line (marks|does not mark) the run as unmeasured under host load$/, (ctx, mark) => {
    const st = ctx.bl1983;
    if (mark === 'marks') {
      assert.match(st.line, /unmeasured under host load/, `expected the work line to mark the run; got: ${st.line}`);
      assert.doesNotMatch(st.line, /REFUSED/, `a marked line must never also read REFUSED; got: ${st.line}`);
      assert.equal(st.decision.unmeasuredUnderLoad, true);
    } else {
      assert.doesNotMatch(st.line, /unmeasured under host load/, `expected no mark; got: ${st.line}`);
      assert.equal(st.decision.unmeasuredUnderLoad, false);
    }
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────
  scoped(
    /^a recorded run on a host with 20 logical cores at a 5-minute load average of ([\d.]+)$/,
    (ctx, load) => {
      ctx.bl1983record = { loadAvg5: Number(load), cores: 20 };
    }
  );

  scoped(/^the run's duration record is written$/, (ctx) => {
    const st = ctx.bl1983record;
    st.record = buildRecord({
      finishedAt: '2026-10-05T07:23:42.000Z',
      testCount: 1161,
      exitCode: 0,
      durationMs: 391647,
      poleMs: 4800,
      workMs: 540000,
      newOffenders: 0,
      watchFiles: 0,
      budgetVerdict: 'ok',
      workBudgetVerdict: 'ok',
      loadAvg5: st.loadAvg5,
      cores: st.cores,
    });
  });

  scoped(/^the record carries a 5-minute load average of ([\d.]+) and 20 cores$/, (ctx, load) => {
    const { record } = ctx.bl1983record;
    assert.equal(record.load_avg_5m, Number(load));
    assert.equal(record.cores, 20);
  });
}

module.exports = { registerSteps };
