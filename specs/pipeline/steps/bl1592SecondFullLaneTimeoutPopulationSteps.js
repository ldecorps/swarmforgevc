'use strict';

// BL-1592: step handlers for "Four more fixture-spawning property files are
// green in a full lane run" (specifier-authored feature, lands with this
// handler in the same parcel - BL-233, BL-1371). Scenarios 01/03 follow
// BL-1588's own shape exactly (bl1588FullLanePropertyTimeoutSteps.js):
// scenario 01 drives the REAL property files as real vitest subprocesses,
// scenario 03 reads the REAL evidence file this parcel writes. Scenario 02
// is a source-level check (a small test(...) call-site scanner, string/
// comment aware - BL-914's testTimeoutParser.js collapses any non-numeric
// trailing argument to timeoutMs: null, discarding the raw expression text
// this scenario needs to inspect, the same reason BL-1600's own scanner was
// not a reuse of it). Scenario 04 is a pure in-process check of
// propertyLaneContentionBudget.js's own budget resolution (BL-1541 shape,
// mirrors BL-1588's own scenario 03) - no subprocess, since the mechanism
// under test IS the function.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { propertyLaneTimeoutMs } = require('../../../extension/test/helpers/propertyLaneContentionBudget');

const FEATURE = 'BL-1592 Four more fixture-spawning property files are green in a full lane run';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'backlog', 'evidence');

const FILES = {
  'extension/test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js': {
    rel: 'test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js',
    basename: 'bl1375ApprovedSiblingsCanLandInvariants.property.test.js',
  },
  'extension/test/bl1309LandDecideEntanglementInvariants.property.test.js': {
    rel: 'test/bl1309LandDecideEntanglementInvariants.property.test.js',
    basename: 'bl1309LandDecideEntanglementInvariants.property.test.js',
  },
  'extension/test/bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js': {
    rel: 'test/bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js',
    basename: 'bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js',
  },
  'extension/test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js': {
    rel: 'test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js',
    basename: 'bl1529ScriptSenderAuditOutcomesInvariant.property.test.js',
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

  // -- Scenario 01: each file, run alone, is green -----------------------
  scoped(/^(.+) runs alone under the properties config$/, (ctx, file) => {
    const known = knownFile(file);
    ctx.bl1592runs = ctx.bl1592runs || {};
    if (!ctx.bl1592runs[file]) {
      const result = runProperty(known.rel);
      ctx.bl1592runs[file] = { result, output: `${result.stdout || ''}${result.stderr || ''}` };
    }
  });

  scoped(/^every test in it passes$/, (ctx) => {
    for (const file of Object.keys(ctx.bl1592runs || {})) {
      const s = ctx.bl1592runs[file];
      assert.equal(s.result.status, 0, `expected ${file} to pass, got:\n${s.output.slice(-4000)}`);
    }
  });

  // -- Scenario 02: source-level, no bare literal, derived from base -----
  scoped(/^the source of (.+) is read$/, (ctx, file) => {
    const known = knownFile(file);
    const source = fs.readFileSync(path.join(EXTENSION_DIR, known.rel), 'utf8');
    ctx.bl1592calls = parseTestCalls(source);
  });

  scoped(/^it declares exactly (\d+) tests$/, (ctx, count) => {
    assert.equal(
      ctx.bl1592calls.length,
      Number(count),
      `expected ${count} test( declarations, found ${ctx.bl1592calls.length}: ${JSON.stringify(ctx.bl1592calls.map((c) => c.name))}`,
    );
  });

  scoped(/^no test in it passes a bare numeric literal as its per-test timeout$/, (ctx) => {
    for (const c of ctx.bl1592calls) {
      if (c.timeoutArg !== null) {
        assert.ok(!/^\d+$/.test(c.timeoutArg), `"${c.name}" declares a bare numeric per-test timeout: ${c.timeoutArg}`);
      }
    }
  });

  scoped(
    /^every test in it receives a per-test budget derived from (\d+) ms through the property lane's budget helper$/,
    (ctx, base) => {
      for (const c of ctx.bl1592calls) {
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

  // -- Scenario 03: the parcel's evidence records the outcome per file ---
  scoped(/^the parcel's evidence for (.+) is read$/, (ctx, file) => {
    const known = knownFile(file);
    const candidates = fs
      .readdirSync(EVIDENCE_DIR)
      .filter((f) => f.startsWith('BL-1592-') && f.endsWith('.md'))
      .map((f) => path.join(EVIDENCE_DIR, f))
      .filter((full) => fs.readFileSync(full, 'utf8').includes(known.basename));
    assert.ok(candidates.length > 0, `no BL-1592 evidence file mentions ${known.basename}`);
    ctx.bl1592evidence = ctx.bl1592evidence || {};
    ctx.bl1592evidence[file] = candidates.map((c) => fs.readFileSync(c, 'utf8')).join('\n---\n');
    ctx.bl1592lastEvidenceFile = file;
  });

  scoped(
    /^it records the failing test name and the timeout message verbatim from a full property-lane run and the change that removed it, or it records at least 5 full lane runs and 20 runs alone all green and the register row retired on that evidence$/,
    (ctx) => {
      const file = ctx.bl1592lastEvidenceFile;
      const text = ctx.bl1592evidence[file];

      const firedRoute = /test timed out/i.test(text) && /removed|fixed|remedy|resolved/i.test(text);
      const retiredRoute =
        /\b5\b[^\n]*full[- ]lane runs?/is.test(text) &&
        /\b20\b[^\n]*(alone|runs alone)/is.test(text) &&
        /retired/i.test(text);

      assert.ok(
        firedRoute || retiredRoute,
        `evidence for ${file} names neither a fired-and-fixed red nor a retired-on-green-runs outcome:\n${text.slice(0, 2000)}`,
      );
    },
  );

  // -- Scenario 04: bl1529's 60s base scales like the 20s base ------------
  scoped(/^the property lane is running (\d+) worker forks$/, (ctx, forks) => {
    ctx.bl1592forks = Number(forks);
  });

  scoped(/^the host's 1-minute load average reads ([\d.]+), inside the quiet band$/, (ctx, load) => {
    ctx.bl1592load = Number(load);
  });

  scoped(/^the per-test budget for bl1529's audit-outcomes test is resolved from its 60000 ms base$/, (ctx) => {
    assert.ok(Number.isFinite(ctx.bl1592forks), 'forks was never set by the Given step');
    assert.ok(Number.isFinite(ctx.bl1592load), 'load was never set by the And step');
    ctx.bl1592budgetMs = propertyLaneTimeoutMs(60000, {
      forksFn: () => ctx.bl1592forks,
      loadavg1mFn: () => ctx.bl1592load,
    });
  });

  scoped(/^the effective budget is (.+)$/, (ctx, outcome) => {
    const ms = ctx.bl1592budgetMs;
    if (outcome === 'exactly 60000 ms') {
      assert.equal(ms, 60000, `expected exactly 60000ms, got ${ms}`);
    } else if (outcome === 'more than 60000 ms') {
      assert.ok(ms > 60000, `expected more than 60000ms, got ${ms}`);
    } else if (outcome === 'three times the 8-fork budget of a 20000 ms base') {
      const twentyBase = propertyLaneTimeoutMs(20000, {
        forksFn: () => ctx.bl1592forks,
        loadavg1mFn: () => ctx.bl1592load,
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
}

module.exports = { registerSteps };
