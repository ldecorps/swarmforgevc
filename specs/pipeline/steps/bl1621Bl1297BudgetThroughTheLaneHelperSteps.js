'use strict';

// BL-1621: step handlers for "The bl1297 property tests derive their budget
// through the lane's helper" (specifier-authored feature, lands with this
// handler in the same parcel - BL-233, BL-1371). Reuses
// bl1606TwoMorePropertyFilesFitAFullLaneSteps.js's own scoped step shapes
// (the ticket's own direction), scoped to this feature and this one file:
// scenario 01 is a source-level call-site scanner (BL-914's
// testTimeoutParser.js collapses any non-numeric trailing argument to
// timeoutMs: null, discarding the raw expression text this scenario needs);
// scenario 02 drives the real file as a real vitest subprocess and checks
// its three BL-1564 reach-map lines; scenario 03 reads the parcel's own
// evidence.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = "BL-1621 The bl1297 property tests derive their budget through the lane's helper";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'backlog', 'evidence');

const FILE_REL = 'test/bl1297MergeOwnPathsInvariants.property.test.js';
const FILE_BASENAME = 'bl1297MergeOwnPathsInvariants.property.test.js';

function runProperty() {
  return spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', FILE_REL], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    timeout: 600000,
  });
}

// -- minimal test(...) call-site scanner, string/comment aware -------------
// Verbatim shape of bl1606TwoMorePropertyFilesFitAFullLaneSteps.js's own
// scanner (never a second, independently-drifting copy of its logic).

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

  // -- Scenario 01: source-level, no bare literal, derived from base ------
  scoped(/^the source of extension\/test\/bl1297MergeOwnPathsInvariants\.property\.test\.js is read$/, (ctx) => {
    const source = fs.readFileSync(path.join(EXTENSION_DIR, FILE_REL), 'utf8');
    ctx.bl1621calls = parseTestCalls(source);
  });

  scoped(/^it declares exactly (\d+) tests?$/, (ctx, count) => {
    assert.equal(
      ctx.bl1621calls.length,
      Number(count),
      `expected ${count} test( declarations, found ${ctx.bl1621calls.length}: ${JSON.stringify(ctx.bl1621calls.map((c) => c.name))}`
    );
  });

  scoped(/^no test in it passes a bare numeric literal as its per-test timeout$/, (ctx) => {
    for (const c of ctx.bl1621calls) {
      if (c.timeoutArg !== null) {
        assert.ok(!/^\d+$/.test(c.timeoutArg), `"${c.name}" declares a bare numeric per-test timeout: ${c.timeoutArg}`);
      }
    }
  });

  scoped(
    /^every test in it receives a per-test budget derived from (\d+) ms through the property lane's budget helper$/,
    (ctx, base) => {
      for (const c of ctx.bl1621calls) {
        assert.notEqual(c.timeoutArg, null, `"${c.name}" declares no per-test timeout at all`);
        assert.ok(
          c.timeoutArg.includes('propertyLaneTimeoutMs'),
          `"${c.name}"'s timeout does not call propertyLaneTimeoutMs: ${c.timeoutArg}`
        );
        assert.ok(c.timeoutArg.includes(base), `"${c.name}"'s timeout does not derive from ${base}: ${c.timeoutArg}`);
      }
    }
  );

  // -- Scenario 02: the file runs alone -------------------------------------
  scoped(/^extension\/test\/bl1297MergeOwnPathsInvariants\.property\.test\.js runs alone under the properties config$/, (ctx) => {
    const result = runProperty();
    ctx.bl1621run = { result, output: `${result.stdout || ''}${result.stderr || ''}` };
  });

  scoped(/^every test in it passes$/, (ctx) => {
    const s = ctx.bl1621run;
    assert.equal(s.result.status, 0, `expected the file to pass, got:\n${s.output.slice(-4000)}`);
  });

  scoped(/^its three BL-1564 reach maps report (\d+), (\d+) and (\d+) cases$/, (ctx, inv1, inv2, inv3) => {
    const output = ctx.bl1621run.output;
    const matches = [...output.matchAll(/BL-1564 reach map \(invariant (\d)\): \{"cases":(\d+)/g)];
    const byInvariant = {};
    for (const m of matches) byInvariant[m[1]] = Number(m[2]);
    assert.equal(byInvariant['1'], Number(inv1), `invariant 1 reach map: ${JSON.stringify(byInvariant)}`);
    assert.equal(byInvariant['2'], Number(inv2), `invariant 2 reach map: ${JSON.stringify(byInvariant)}`);
    assert.equal(byInvariant['3'], Number(inv3), `invariant 3 reach map: ${JSON.stringify(byInvariant)}`);
  });

  // -- Scenario 03: the parcel's evidence records the outcome ---------------
  scoped(/^the parcel's evidence for extension\/test\/bl1297MergeOwnPathsInvariants\.property\.test\.js is read$/, (ctx) => {
    const candidates = fs
      .readdirSync(EVIDENCE_DIR)
      .filter((f) => f.startsWith('BL-1621-') && f.endsWith('.md'))
      .map((f) => path.join(EVIDENCE_DIR, f))
      .filter((full) => fs.readFileSync(full, 'utf8').includes(FILE_BASENAME));
    assert.ok(candidates.length > 0, `no BL-1621 evidence file mentions ${FILE_BASENAME}`);
    ctx.bl1621evidence = candidates.map((c) => fs.readFileSync(c, 'utf8')).join('\n---\n');
  });

  scoped(
    /^it records the failing test name and the timeout message verbatim from a full property-lane run and the change that removed it$/,
    (ctx) => {
      const text = ctx.bl1621evidence;
      assert.match(text, /test timed out/i, `evidence does not quote a timeout message:\n${text.slice(0, 2000)}`);
      assert.match(
        text,
        /removed|fixed|remedy|resolved/i,
        `evidence does not record the remedy:\n${text.slice(0, 2000)}`
      );
    }
  );
}

module.exports = { registerSteps };
