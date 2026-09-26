'use strict';

// BL-1764: step handlers for "nightClosingCeremonyRun's unit tests never
// read the wall clock" - a source-text census only, never a
// reimplementation of the runner or a real ceremony run.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE = "BL-1764 nightClosingCeremonyRun's unit tests never read the wall clock";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

// KNOWN_VALUES (engineering.prompt, Acceptance Pipeline): a Scenario Outline
// handler must validate against the fixed set of literals the ticket names,
// never pass an Examples value straight into a search with no check. Without
// this, a BL-113 mutation of the Examples cell (e.g. "Date.now()" ->
// "Date.nOw()") searches for a different absent string and still finds 0
// occurrences - indistinguishable from the unmutated search once the file
// has zero wall-clock reads at all, so the mutant survived.
const KNOWN_WALL_CLOCK_LITERALS = ['Date.now()', 'new Date()'];

function countOccurrences(source, literal) {
  let count = 0;
  let idx = 0;
  while ((idx = source.indexOf(literal, idx)) !== -1) {
    count += 1;
    idx += literal.length;
  }
  return count;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the unit test file "([^"]+)"$/, (ctx, file) => {
    ctx.file = file;
    ctx.source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  });

  scoped(/^its source is scanned for "([^"]+)"$/, (ctx, literal) => {
    assert.ok(
      KNOWN_WALL_CLOCK_LITERALS.includes(literal),
      `unrecognized wall-clock literal "${literal}" - expected one of ${JSON.stringify(KNOWN_WALL_CLOCK_LITERALS)} (KNOWN_VALUES check)`
    );
    ctx.lastCount = countOccurrences(ctx.source, literal);
    ctx.lastLiteral = literal;
  });

  scoped(/^the scan finds (\d+) occurrences$/, (ctx, expected) => {
    assert.equal(
      ctx.lastCount,
      Number(expected),
      `expected ${expected} occurrence(s) of "${ctx.lastLiteral}" in ${ctx.file}, found ${ctx.lastCount}`
    );
  });

  scoped(/^its tests and runner calls are counted$/, (ctx) => {
    ctx.testCount = (ctx.source.match(/^\s*test\(/gm) || []).length;
    ctx.runnerCallCount = countOccurrences(ctx.source, 'runNightClosingCeremony(');
  });

  scoped(/^it declares at least (\d+) tests$/, (ctx, min) => {
    assert.ok(ctx.testCount >= Number(min), `expected at least ${min} tests, found ${ctx.testCount}`);
  });

  scoped(/^it calls runNightClosingCeremony at least (\d+) times$/, (ctx, min) => {
    assert.ok(
      ctx.runnerCallCount >= Number(min),
      `expected at least ${min} runNightClosingCeremony( calls, found ${ctx.runnerCallCount}`
    );
  });
}

module.exports = { registerSteps };
