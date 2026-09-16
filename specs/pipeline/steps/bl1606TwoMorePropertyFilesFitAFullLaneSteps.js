'use strict';

// BL-1606: step handlers for "Two more fixture-spawning property files fit
// a full lane and no lane budget resolves below its base" (specifier-
// authored feature, lands with this handler in the same parcel - BL-233,
// BL-1371). Follows bl1592SecondFullLaneTimeoutPopulationSteps.js's own
// shape exactly (the ticket's own direction): scenario 01 is a source-level
// check (a small test(...) call-site scanner, string/comment aware -
// BL-914's testTimeoutParser.js collapses any non-numeric trailing argument
// to timeoutMs: null, discarding the raw expression text this scenario
// needs to inspect); scenario 02 is a pure in-process check of
// propertyLaneContentionBudget.js's own budget resolution (BL-1541 shape -
// no subprocess, since the mechanism under test IS the function); scenario
// 03 drives the real bl1304 property file as a real vitest subprocess;
// scenario 04 reads the parcel's own evidence.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { propertyLaneTimeoutMs } = require('../../../extension/test/helpers/propertyLaneContentionBudget');

const FEATURE = 'BL-1606 Two more fixture-spawning property files fit a full lane and no lane budget resolves below its base';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'backlog', 'evidence');

const FILES = {
  'extension/test/bl1304DryRunSpawnsNothing.property.test.js': {
    rel: 'test/bl1304DryRunSpawnsNothing.property.test.js',
    basename: 'bl1304DryRunSpawnsNothing.property.test.js',
  },
  'extension/test/bl968MaterializedGuardSensitivity.property.test.js': {
    rel: 'test/bl968MaterializedGuardSensitivity.property.test.js',
    basename: 'bl968MaterializedGuardSensitivity.property.test.js',
  },
};

function runProperty(rel) {
  return spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', rel], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    timeout: 600000,
  });
}

// -- minimal test(...) call-site scanner, string/comment aware -------------
// Verbatim shape of bl1592SecondFullLaneTimeoutPopulationSteps.js's own
// scanner (never a second, independently-drifting copy of its logic - this
// IS that copy, mirrored per the ticket's own "How" direction: "the
// BL-1592/BL-1595 step shape, scoped to this feature").

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

function knownFile(file) {
  const known = FILES[file];
  if (!known) {
    throw new Error(`unknown file example value: "${file}"`);
  }
  return known;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // -- Scenario 01: source-level, no bare literal, derived from base ------
  scoped(/^the source of (.+) is read$/, (ctx, file) => {
    const known = knownFile(file);
    const source = fs.readFileSync(path.join(EXTENSION_DIR, known.rel), 'utf8');
    ctx.bl1606calls = parseTestCalls(source);
  });

  scoped(/^it declares exactly (\d+) tests?$/, (ctx, count) => {
    assert.equal(
      ctx.bl1606calls.length,
      Number(count),
      `expected ${count} test( declarations, found ${ctx.bl1606calls.length}: ${JSON.stringify(ctx.bl1606calls.map((c) => c.name))}`,
    );
  });

  scoped(/^no test in it passes a bare numeric literal as its per-test timeout$/, (ctx) => {
    for (const c of ctx.bl1606calls) {
      if (c.timeoutArg !== null) {
        assert.ok(!/^\d+$/.test(c.timeoutArg), `"${c.name}" declares a bare numeric per-test timeout: ${c.timeoutArg}`);
      }
    }
  });

  scoped(
    /^every test in it receives a per-test budget derived from (\d+) ms through the property lane's budget helper$/,
    (ctx, base) => {
      for (const c of ctx.bl1606calls) {
        assert.notEqual(c.timeoutArg, null, `"${c.name}" declares no per-test timeout at all`);
        assert.ok(
          c.timeoutArg.includes('propertyLaneTimeoutMs'),
          `"${c.name}"'s timeout does not call propertyLaneTimeoutMs: ${c.timeoutArg}`,
        );
        assert.ok(
          c.timeoutArg.includes(base),
          `"${c.name}"'s timeout does not derive from ${base}: ${c.timeoutArg}`,
        );
      }
    },
  );

  // -- Scenario 02: the helper itself, in process --------------------------
  scoped(/^the property lane is running (\d+) worker forks$/, (ctx, forks) => {
    ctx.bl1606forks = Number(forks);
  });

  scoped(/^the host's 1-minute load average reads ([\d.]+), inside the quiet band$/, (ctx, load) => {
    ctx.bl1606load = Number(load);
  });

  scoped(/^the per-test budget for a fixture-spawning property test is resolved from a (\d+) ms base$/, (ctx, base) => {
    assert.ok(Number.isFinite(ctx.bl1606forks), 'forks was never set by the Given step');
    assert.ok(Number.isFinite(ctx.bl1606load), 'load was never set by the And step');
    ctx.bl1606base = Number(base);
    ctx.bl1606budgetMs = propertyLaneTimeoutMs(ctx.bl1606base, {
      forksFn: () => ctx.bl1606forks,
      loadavg1mFn: () => ctx.bl1606load,
    });
  });

  scoped(/^the effective budget is (.+)$/, (ctx, outcome) => {
    const ms = ctx.bl1606budgetMs;
    let m = outcome.match(/^exactly (\d+) ms$/);
    if (m) {
      assert.equal(ms, Number(m[1]), `expected exactly ${m[1]}ms, got ${ms}`);
      return;
    }
    m = outcome.match(/^more than (\d+) ms$/);
    if (m) {
      assert.ok(ms > Number(m[1]), `expected more than ${m[1]}ms, got ${ms}`);
      return;
    }
    m = outcome.match(/^at least (\d+) ms$/);
    if (m) {
      assert.ok(ms >= Number(m[1]), `expected at least ${m[1]}ms, got ${ms}`);
      return;
    }
    throw new Error(`unknown <outcome>: "${outcome}"`);
  });

  // -- Scenario 03: bl1304 runs alone -------------------------------------
  scoped(/^(.+) runs alone under the properties config$/, (ctx, file) => {
    const known = knownFile(file);
    const result = runProperty(known.rel);
    ctx.bl1606run = { result, output: `${result.stdout || ''}${result.stderr || ''}` };
  });

  scoped(/^every test in it passes$/, (ctx) => {
    const s = ctx.bl1606run;
    assert.equal(s.result.status, 0, `expected the file to pass, got:\n${s.output.slice(-4000)}`);
  });

  // -- Scenario 04: the parcel's evidence records the outcome per file ----
  scoped(/^the parcel's evidence for (.+) is read$/, (ctx, file) => {
    const known = knownFile(file);
    const candidates = fs
      .readdirSync(EVIDENCE_DIR)
      .filter((f) => f.startsWith('BL-1606-') && f.endsWith('.md'))
      .map((f) => path.join(EVIDENCE_DIR, f))
      .filter((full) => fs.readFileSync(full, 'utf8').includes(known.basename));
    assert.ok(candidates.length > 0, `no BL-1606 evidence file mentions ${known.basename}`);
    ctx.bl1606evidence = ctx.bl1606evidence || {};
    ctx.bl1606evidence[file] = candidates.map((c) => fs.readFileSync(c, 'utf8')).join('\n---\n');
    ctx.bl1606lastEvidenceFile = file;
  });

  scoped(
    /^it records the failing test name and the timeout message verbatim from a full property-lane run and the change that removed it$/,
    (ctx) => {
      const file = ctx.bl1606lastEvidenceFile;
      const text = ctx.bl1606evidence[file];
      assert.match(text, /test timed out/i, `evidence for ${file} does not quote a timeout message:\n${text.slice(0, 2000)}`);
      assert.match(
        text,
        /removed|fixed|remedy|resolved/i,
        `evidence for ${file} does not record the remedy:\n${text.slice(0, 2000)}`,
      );
    },
  );
}

module.exports = { registerSteps };
