'use strict';

// BL-1600: step handlers for "the shipped-step collision scan gets the unit
// lane's contention budget". Scenario 01 parses the REAL test file's source
// to confirm exactly one it() call declares a trailing per-test timeout,
// that it is the shipped-scan test, and that its argument text references
// resolveUnitLaneTimeout(20000) rather than a bare numeric literal - a
// small, file-scoped it(...) call-site scanner. BL-914's
// testTimeoutParser.js only recognizes test(...) call sites (this file uses
// it(...)) and collapses any non-numeric trailing argument to
// timeoutMs: null, discarding the raw expression text this scenario needs
// to inspect, so it is not reused here rather than widened for one caller.
// Scenario 02 drives the REAL resolveUnitLaneTimeout helper with injected
// factors - no hand-copied arithmetic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveUnitLaneTimeout } = require('./lib/contentionBudget');

const TARGET_FILE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'extension',
  'test',
  'bl1277UnscopedStepCollisionGuard.test.js'
);
const SHIPPED_SCAN_TEST_NAME = 'the shipped step files register no colliding unscoped pattern';

const FEATURE = "BL-1600 The shipped-step collision scan gets the unit lane's contention budget";

// -- minimal it(...) call-site scanner, string/comment aware ---------------

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

// Every top-level it(name, fn[, timeoutArg]) call site in sourceText - name
// (string literal, unescaped) and timeoutArg (the raw, un-evaluated text of
// a 3rd argument, or null when the call has fewer than 3 top-level args).
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

  // -- Scenario 01 ------------------------------------------------------
  scoped(/^the source of extension\/test\/bl1277UnscopedStepCollisionGuard\.test\.js is read$/, (ctx) => {
    ctx.bl1600source = fs.readFileSync(TARGET_FILE, 'utf8');
    ctx.bl1600calls = parseItCalls(ctx.bl1600source);
  });

  scoped(/^exactly one test in it declares a per-test timeout$/, (ctx) => {
    const timed = ctx.bl1600calls.filter((c) => c.timeoutArg !== null);
    assert.equal(
      timed.length,
      1,
      `expected exactly one it(...) call with a per-test timeout, found ${timed.length}: ${JSON.stringify(
        timed.map((c) => c.name)
      )}`
    );
    ctx.bl1600timedCall = timed[0];
  });

  scoped(
    /^that test is the shipped-step scan and its timeout is derived from 20000 ms through resolveUnitLaneTimeout, never a bare literal$/,
    (ctx) => {
      const { name, timeoutArg } = ctx.bl1600timedCall;
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
    }
  );

  // -- Scenario 02 (Outline) ---------------------------------------------
  scoped(/^a recorded contention factor of ([\d.]+)$/, (ctx, factor) => {
    ctx.bl1600factor = Number(factor);
  });

  scoped(/^the unit lane timeout is resolved from a 20000 ms base$/, (ctx) => {
    ctx.bl1600resolved = resolveUnitLaneTimeout(20000, { factor: ctx.bl1600factor });
  });

  scoped(/^the effective budget is (\d+) ms$/, (ctx, budget) => {
    assert.equal(ctx.bl1600resolved.effectiveMs, Number(budget));
  });
}

module.exports = { registerSteps };
