'use strict';

// BL-1595: step handlers for "The front-desk bot CLI property file derives
// its 60-second budgets from the lane helper". Scenario 01 is a
// source-level check (a small test(...) call-site scanner, string/comment
// aware - the same technique BL-1592's own steps use, since BL-914's
// testTimeoutParser.js collapses a non-numeric trailing argument to
// timeoutMs: null, discarding the raw text this scenario needs). Scenario
// 02 is a pure in-process check of propertyLaneContentionBudget.js's own
// budget resolution (BL-1541 shape, mirrors BL-1592's own scenario 04) -
// no subprocess, since the mechanism under test IS the function. Scenario
// 03 reads the REAL evidence file this parcel writes.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { propertyLaneTimeoutMs } = require('../../../extension/test/helpers/propertyLaneContentionBudget');

const FEATURE = "BL-1595 The front-desk bot CLI property file derives its 60-second budgets from the lane helper";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'backlog', 'evidence');
const TARGET_FILE = path.join(EXTENSION_DIR, 'test', 'telegramFrontDeskBotCli.property.test.js');

// -- minimal test(...) call-site scanner, string/comment aware -------------

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

// Every top-level test(name, fn[, timeoutArg]) call site in sourceText -
// name (string literal, unescaped) and timeoutArg (the raw, un-evaluated
// text of a 3rd argument, or null when the call has fewer than 3 top-level
// args, wherever the arg falls in a multi-line call).
function parseTestCalls(sourceText) {
  const calls = [];
  const callRegex = /(?:^|[^.\w])test\s*\(/g;
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

  // -- Scenario 01: source-level, no bare literal, derived from base -----
  scoped(/^the source of extension\/test\/telegramFrontDeskBotCli\.property\.test\.js is read$/, (ctx) => {
    const source = fs.readFileSync(TARGET_FILE, 'utf8');
    ctx.bl1595calls = parseTestCalls(source);
  });

  scoped(/^it declares exactly (\d+) tests$/, (ctx, count) => {
    assert.equal(
      ctx.bl1595calls.length,
      Number(count),
      `expected ${count} test( declarations, found ${ctx.bl1595calls.length}: ${JSON.stringify(ctx.bl1595calls.map((c) => c.name))}`,
    );
  });

  scoped(/^it declares exactly (\d+) per-test timeouts$/, (ctx, count) => {
    const timed = ctx.bl1595calls.filter((c) => c.timeoutArg !== null);
    assert.equal(
      timed.length,
      Number(count),
      `expected ${count} per-test timeouts, found ${timed.length}: ${JSON.stringify(timed.map((c) => c.name))}`,
    );
  });

  scoped(/^no test in it passes a bare numeric literal as its per-test timeout$/, (ctx) => {
    for (const c of ctx.bl1595calls) {
      if (c.timeoutArg !== null) {
        assert.ok(!/^\d+$/.test(c.timeoutArg), `"${c.name}" declares a bare numeric per-test timeout: ${c.timeoutArg}`);
      }
    }
  });

  scoped(/^every per-test timeout it declares is derived from (\d+) ms through the property lane's budget helper$/, (ctx, base) => {
    const timed = ctx.bl1595calls.filter((c) => c.timeoutArg !== null);
    for (const c of timed) {
      assert.ok(
        c.timeoutArg.includes('propertyLaneTimeoutMs'),
        `"${c.name}"'s timeout does not call propertyLaneTimeoutMs: ${c.timeoutArg}`,
      );
      assert.ok(c.timeoutArg.includes(base), `"${c.name}"'s timeout does not derive from ${base}: ${c.timeoutArg}`);
    }
  });

  // -- Scenario 02 (Outline): budget scales like the 20s base -------------
  scoped(/^the property lane is running (\d+) worker forks$/, (ctx, forks) => {
    ctx.bl1595forks = Number(forks);
  });

  scoped(/^the host's 1-minute load average reads ([\d.]+), inside the quiet band$/, (ctx, load) => {
    ctx.bl1595load = Number(load);
  });

  scoped(/^the per-test budget for the file's fixture-spawning tests is resolved from their 60000 ms base$/, (ctx) => {
    assert.ok(Number.isFinite(ctx.bl1595forks), 'forks was never set by the Given step');
    assert.ok(Number.isFinite(ctx.bl1595load), 'load was never set by the And step');
    ctx.bl1595budgetMs = propertyLaneTimeoutMs(60000, {
      forksFn: () => ctx.bl1595forks,
      loadavg1mFn: () => ctx.bl1595load,
    });
  });

  scoped(/^the effective budget is (.+)$/, (ctx, outcome) => {
    const ms = ctx.bl1595budgetMs;
    if (outcome === 'exactly 60000 ms') {
      assert.equal(ms, 60000, `expected exactly 60000ms, got ${ms}`);
    } else if (outcome === 'more than 60000 ms') {
      assert.ok(ms > 60000, `expected more than 60000ms, got ${ms}`);
    } else if (outcome === 'three times the 8-fork budget of a 20000 ms base') {
      const twentyBase = propertyLaneTimeoutMs(20000, {
        forksFn: () => ctx.bl1595forks,
        loadavg1mFn: () => ctx.bl1595load,
      });
      assert.equal(
        ms,
        twentyBase * 3,
        `expected 3x the 20000ms-base 8-fork budget (${twentyBase}ms -> ${twentyBase * 3}ms), got ${ms}`,
      );
    } else {
      throw new Error(`unknown outcome example value: "${outcome}"`);
    }
  });

  // -- Scenario 03: the parcel's evidence records the outcome ------------
  scoped(/^BL-1595's evidence file is read$/, (ctx) => {
    const candidates = fs
      .readdirSync(EVIDENCE_DIR)
      .filter((f) => f.startsWith('BL-1595-') && f.endsWith('.md'))
      .map((f) => path.join(EVIDENCE_DIR, f));
    assert.ok(candidates.length > 0, 'no BL-1595 evidence file exists');
    ctx.bl1595evidence = candidates.map((c) => fs.readFileSync(c, 'utf8')).join('\n---\n');
  });

  scoped(
    /^it records the failing test name and the timeout message verbatim from a full property-lane run and the change that removed it$/,
    (ctx) => {
      const text = ctx.bl1595evidence;
      assert.match(text, /test timed out/i, `evidence does not name the timeout text verbatim:\n${text.slice(0, 2000)}`);
      assert.match(
        text,
        /removed|fixed|remedy|resolved/i,
        `evidence does not name the change that removed it:\n${text.slice(0, 2000)}`,
      );
    },
  );
}

module.exports = { registerSteps };
