'use strict';

// BL-638: classifies the vendored (pinned) gherkin-mutator's JSON summary
// into pass/fail/inapplicable. Split out of gherkinMutationOutcome.js
// (BL-638 cleanup pass) because this is pure decision logic over the report
// - no feature-file text I/O - which is a different responsibility from
// gherkinMutationManifest.js's manifest/stamp text mechanics.
//
// The distinguishing signal: `SkippedMutations` is only ever positive when
// `discover` found real Examples-table mutations that a valid stamp let a
// soft run reuse. An outline-free feature's `discover` always returns zero
// mutations, so `SkippedMutations` stays absent/zero on every run regardless
// of stamp state - that is what separates "nothing to mutate" from "already
// verified and cached".

function classifyOutcome(summary) {
  const s = summary || {};
  const total = s.Total || 0;
  const survived = s.Survived || 0;
  const errors = s.Errors || 0;
  const skippedMutations = s.SkippedMutations || 0;

  if (total === 0 && skippedMutations === 0) {
    return 'inapplicable';
  }
  if (survived > 0 || errors > 0) {
    return 'fail';
  }
  return 'pass';
}

function exitCodeFor(outcome) {
  if (outcome === 'inapplicable') return 2;
  if (outcome === 'fail') return 1;
  return 0;
}

module.exports = {
  classifyOutcome,
  exitCodeFor,
};
