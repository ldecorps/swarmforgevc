'use strict';

// BL-1721: step handlers for "A failed pole confirmation is said and
// retried once". Drives the REAL checkFileDurationBudget/
// formatBudgetOffenders (check-suite-file-budget.ts) with an injected
// stand-in confirmAlone matching each Example row's own known
// confirmation sequence - never a reimplementation of the retry-once
// decision or the line format.

const assert = require('node:assert/strict');
const { checkFileDurationBudget, formatBudgetOffenders } = require('../../../extension/out/tools/check-suite-file-budget');

const FEATURE = 'BL-1721 A failed pole confirmation is said and retried once';

const FILE = 'test/F.test.js';
const IN_SUITE_MS = 10900;
const BUDGET_MS = 7000;

// Each entry is the ORDERED sequence of confirmAlone results the guard's
// (at most two) calls receive - never a single passthrough value.
const KNOWN_CONFIRMATIONS = {
  'fail once, then measure 4.2 s': [{ failed: 'ECONNRESET' }, { ms: 4200 }],
  'fail twice': [{ failed: 'spawn error: ENOENT' }, { failed: 'confirmation killed by signal SIGTERM' }],
  'measure 8.0 s': [{ ms: 8000 }],
};

const KNOWN_VERDICTS = { contention: 'contention', 'a new pole': 'new-pole' };

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a suite report in which file F ran 10\.9 s against the 7\.0 s per-file budget and has no pole register row$/,
    (ctx) => {
      ctx.durations = [{ file: FILE, durationMs: IN_SUITE_MS }];
    }
  );

  scoped(/^F's alone confirmations (.+)$/, (ctx, raw) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_CONFIRMATIONS, raw)) {
      throw new Error(`bl1721: unrecognized <confirmations> example value "${raw}"`);
    }
    ctx.confirmations = KNOWN_CONFIRMATIONS[raw].slice();
  });

  scoped(/^the per-file budget guard judges the report$/, (ctx) => {
    const calls = [];
    const confirmAlone = (file) => {
      calls.push(file);
      const next = ctx.confirmations.shift();
      if (!next) {
        throw new Error('bl1721: confirmAlone called more times than the example provided results for');
      }
      return next;
    };
    ctx.result = checkFileDurationBudget(ctx.durations, BUDGET_MS, [], new Set(), confirmAlone);
    ctx.calls = calls;
  });

  scoped(/^F is judged (contention|a new pole)$/, (ctx, verdictRaw) => {
    const expected = KNOWN_VERDICTS[verdictRaw];
    assert.equal(ctx.result.verdict, expected, `expected verdict "${expected}", got: ${JSON.stringify(ctx.result)}`);
  });

  scoped(/^the guard's line for F names (.+)$/, (ctx, reportedRaw) => {
    let line;
    if (ctx.result.verdict === 'contention') {
      const c = ctx.result.contention.find((x) => x.file === FILE);
      assert.ok(c, `expected a contention entry for ${FILE}, got: ${JSON.stringify(ctx.result.contention)}`);
      line = `${(c.durationMs / 1000).toFixed(1)}s in-suite, ${(c.aloneMs / 1000).toFixed(1)}s alone`;
    } else {
      line = formatBudgetOffenders(ctx.result.offenders.filter((o) => o.file === FILE));
    }

    switch (reportedRaw) {
      case 'the in-suite 10.9 s and the alone 4.2 s':
        assert.match(line, /10\.9s/);
        assert.match(line, /4\.2s/);
        break;
      case 'the in-suite 10.9 s and both confirmation failures':
        assert.match(line, /10\.9s/);
        assert.match(line, /ENOENT/);
        assert.match(line, /SIGTERM/);
        break;
      case 'the in-suite 10.9 s and the alone 8.0 s':
        assert.match(line, /10\.9s/);
        assert.match(line, /8\.0s/);
        break;
      default:
        throw new Error(`bl1721: unrecognized <reported> example value "${reportedRaw}"`);
    }
  });
}

module.exports = { registerSteps };
