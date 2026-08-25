'use strict';

const assert = require('node:assert/strict');

// BL-113: step handlers for mutation-wiring.feature - a test-only fixture
// proving gherkin-mutator's wiring, not a real ticket. One scenario's
// example value is genuinely load-bearing (asserted against a fixed,
// independently-known count, so a mutated example value fails the
// assertion - mutant KILLED); the other's is accepted but never checked
// (any mutated value still matches - mutant SURVIVES). count is matched as
// -?\d+ since gherkin-mutator's integer mutation can produce a negative
// value.
function registerSteps(registry) {
  registry.define(/^three items exist$/, (ctx) => {
    ctx.count = 3;
  });

  registry.define(/^the count is (-?\d+)$/, (ctx, countText) => {
    assert.equal(ctx.count, Number(countText));
  });

  registry.define(/^the count was merely accepted as (-?\d+)$/, () => {
    // Deliberately never asserts anything about the captured value - this
    // is the fixture's "not load-bearing" half.
  });
}

module.exports = { registerSteps };
