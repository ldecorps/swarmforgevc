'use strict';

// BL-1607: step handlers for "the shipped-step collision scan's budget
// grows with the unit lane's own concurrency". Scenario 01 reuses the same
// minimal it(...) call-site scanner BL-1600's steps use (source-text, not
// a JS parser - the file is small and the shape is fixed) to confirm the
// scan's timeout argument still names resolveUnitLaneTimeout(20000) (BL-1600
// invariant 2) and now also the fork-aware factor. Scenario 02 drives the
// REAL unitLaneHeavyContentionFactor + resolveUnitLaneTimeout helpers with
// injected forks/load - no hand-copied arithmetic. Scenario 03 reads
// vitest.config.mjs's own source. Scenario 04 reads the parcel's evidence.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveUnitLaneTimeout } = require('./lib/contentionBudget');
const { unitLaneHeavyContentionFactor } = require('../../../extension/test/helpers/unitLaneContentionBudget');

const TARGET_FILE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'extension',
  'test',
  'bl1277UnscopedStepCollisionGuard.test.js'
);
const VITEST_CONFIG_FILE = path.join(__dirname, '..', '..', '..', 'extension', 'vitest.config.mjs');
const SHIPPED_SCAN_TEST_NAME = 'the shipped step files register no colliding unscoped pattern';

const FEATURE = "BL-1607 The shipped-step collision scan's budget grows with the unit lane's own concurrency";

// -- minimal it(...) call-site scanner (same shape as BL-1600's steps) -----

function stringOrCommentEnd(text, i) {
  const c = text[i];
  if (c === '"' || c === "'" || c === '`') {
    let j = i + 1;
    while (j < text.length && text[j] !== c) {
      if (text[j] === '\\') j += 1;
      j += 1;
    }
    return j;
  }
  if (c === '/' && text[i + 1] === '/') {
    let j = i;
    while (j < text.length && text[j] !== '\n') j += 1;
    return j;
  }
  if (c === '/' && text[i + 1] === '*') {
    let j = i + 2;
    while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j += 1;
    return j + 1;
  }
  return null;
}

function scanBalanced(text, openIdx) {
  let depth = 0;
  const start = openIdx + 1;
  let i = openIdx;
  for (; i < text.length; i += 1) {
    const c = text[i];
    const skip = stringOrCommentEnd(text, i);
    if (skip !== null) {
      i = skip;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') {
      depth += 1;
    } else if (c === ')' || c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) {
        return { end: i + 1, text: text.slice(start, i) };
      }
    }
  }
  return { end: text.length, text: text.slice(start) };
}

function splitTopLevelArgs(argsText) {
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < argsText.length; i += 1) {
    const c = argsText[i];
    const skip = stringOrCommentEnd(argsText, i);
    if (skip !== null) {
      i = skip;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') {
      depth += 1;
    } else if (c === ')' || c === '}' || c === ']') {
      depth -= 1;
    } else if (c === ',' && depth === 0) {
      args.push(argsText.slice(start, i));
      start = i + 1;
    }
  }
  args.push(argsText.slice(start));
  return args.map((a) => a.trim()).filter((a) => a.length > 0);
}

function extractStringLiteralValue(text) {
  const trimmed = text.trim();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'" && quote !== '`') {
    return null;
  }
  let j = 1;
  while (j < trimmed.length && trimmed[j] !== quote) {
    if (trimmed[j] === '\\') j += 1;
    j += 1;
  }
  return trimmed.slice(1, j).replace(/\\(.)/g, '$1');
}

function parseItCalls(sourceText) {
  const calls = [];
  const callRegex = /(?:^|[^.\w])it\s*\(/g;
  let match = callRegex.exec(sourceText);
  while (match) {
    const openIdx = match.index + match[0].length - 1;
    const { end, text: argsText } = scanBalanced(sourceText, openIdx);
    const args = splitTopLevelArgs(argsText);
    callRegex.lastIndex = end;
    if (args.length > 0) {
      const name = extractStringLiteralValue(args[0]);
      if (name !== null) {
        calls.push({
          name,
          timeoutArg: args.length >= 3 ? args[args.length - 1].trim() : null,
        });
      }
    }
    match = callRegex.exec(sourceText);
  }
  return calls;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // -- Scenario 01 --------------------------------------------------------
  scoped(/^the source of extension\/test\/bl1277UnscopedStepCollisionGuard\.test\.js is read$/, (ctx) => {
    ctx.bl1607source = fs.readFileSync(TARGET_FILE, 'utf8');
    ctx.bl1607calls = parseItCalls(ctx.bl1607source);
  });

  scoped(/^exactly one test in it declares a per-test timeout$/, (ctx) => {
    const timed = ctx.bl1607calls.filter((c) => c.timeoutArg !== null);
    assert.equal(
      timed.length,
      1,
      `expected exactly one it(...) call with a per-test timeout, found ${timed.length}: ${JSON.stringify(
        timed.map((c) => c.name)
      )}`
    );
    ctx.bl1607timedCall = timed[0];
  });

  scoped(
    /^that test is the shipped-step scan and its timeout is derived from 20000 ms through resolveUnitLaneTimeout with the unit lane's fork-aware contention factor, never the core-count default$/,
    (ctx) => {
      const { name, timeoutArg } = ctx.bl1607timedCall;
      assert.equal(
        name,
        SHIPPED_SCAN_TEST_NAME,
        `expected the timed test to be "${SHIPPED_SCAN_TEST_NAME}", got "${name}"`
      );
      assert.ok(
        !/^\d+$/.test(timeoutArg),
        `expected the timeout argument to not be a bare numeric literal, got "${timeoutArg}"`
      );
      assert.ok(
        timeoutArg.includes('resolveUnitLaneTimeout'),
        `expected the timeout argument to call resolveUnitLaneTimeout, got "${timeoutArg}"`
      );
      assert.ok(
        timeoutArg.includes('20000'),
        `expected the timeout argument to derive from 20000, got "${timeoutArg}"`
      );
      assert.ok(
        timeoutArg.includes('unitLaneHeavyContentionFactor'),
        `expected the timeout argument to name unitLaneHeavyContentionFactor (the fork-aware factor), got "${timeoutArg}"`
      );
    }
  );

  // -- Scenario 02 (Outline) -----------------------------------------------
  scoped(/^the unit lane has published (\d+) worker forks$/, (ctx, forks) => {
    ctx.bl1607forks = Number(forks);
  });

  scoped(/^the host's 1-minute load average reads ([\d.]+)$/, (ctx, load) => {
    ctx.bl1607load = Number(load);
  });

  scoped(/^the shipped-step scan's budget is resolved from its 20000 ms base$/, (ctx) => {
    const factor = unitLaneHeavyContentionFactor({
      forksFn: () => ctx.bl1607forks,
      loadavg1mFn: () => ctx.bl1607load,
    });
    ctx.bl1607resolved = resolveUnitLaneTimeout(20000, { factor });
  });

  scoped(/^the effective budget is (\d+) ms$/, (ctx, budget) => {
    assert.equal(ctx.bl1607resolved.effectiveMs, Number(budget));
  });

  // -- Scenario 03 ----------------------------------------------------------
  scoped(/^the source of extension\/vitest\.config\.mjs is read$/, (ctx) => {
    ctx.bl1607configSource = fs.readFileSync(VITEST_CONFIG_FILE, 'utf8');
  });

  scoped(/^it publishes the unit lane's fork count to the environment before the config is defined$/, (ctx) => {
    const assignIdx = ctx.bl1607configSource.indexOf('process.env[UNIT_LANE_FORKS_ENV_KEY]');
    const defineIdx = ctx.bl1607configSource.indexOf('defineConfig({');
    assert.ok(assignIdx !== -1, 'expected vitest.config.mjs to assign process.env[UNIT_LANE_FORKS_ENV_KEY]');
    assert.ok(defineIdx !== -1, 'expected vitest.config.mjs to call defineConfig({');
    assert.ok(assignIdx < defineIdx, 'expected the fork-count publish to happen before defineConfig({ is called');
    ctx.bl1607configAssignLine = ctx.bl1607configSource.slice(assignIdx, ctx.bl1607configSource.indexOf('\n', assignIdx));
  });

  scoped(
    /^that count is resolved through the property lane helper's resolveLaneForks from the invocation's explicit file arguments and the pool ceiling, never a copy of its math$/,
    (ctx) => {
      assert.ok(
        ctx.bl1607configAssignLine.includes('resolveLaneForks(process.argv'),
        `expected the publish line to call resolveLaneForks(process.argv, ...), got "${ctx.bl1607configAssignLine}"`
      );
      assert.ok(
        ctx.bl1607configSource.includes("require('./test/helpers/propertyLaneContentionBudget')"),
        'expected vitest.config.mjs to import resolveLaneForks from the property lane helper, never redefine it'
      );
    }
  );

  // -- Scenario 04 ------------------------------------------------------------
  scoped(/^BL-1607's evidence file is read$/, (ctx) => {
    const evidenceDir = path.join(__dirname, '..', '..', '..', 'backlog', 'evidence');
    const file = fs
      .readdirSync(evidenceDir)
      .find((f) => f.startsWith('BL-1607-coder-') && f.endsWith('.md'));
    assert.ok(file, `expected a BL-1607-coder-*.md evidence file in ${evidenceDir}`);
    ctx.bl1607evidence = fs.readFileSync(path.join(evidenceDir, file), 'utf8');
  });

  scoped(
    /^it records the failing test name and the timeout message verbatim from a full unit-lane run and the change that removed it$/,
    (ctx) => {
      assert.ok(
        ctx.bl1607evidence.includes(SHIPPED_SCAN_TEST_NAME),
        'expected the evidence to name the shipped-step scan test verbatim'
      );
      assert.ok(
        ctx.bl1607evidence.includes('Test timed out in 20000ms.'),
        'expected the evidence to record the timeout message verbatim'
      );
      assert.ok(
        /unitLaneHeavyContentionFactor|SWARMFORGE_UNIT_LANE_FORKS/.test(ctx.bl1607evidence),
        'expected the evidence to describe the remedy (the fork-aware factor / published fork count)'
      );
    }
  );
}

module.exports = { registerSteps };
