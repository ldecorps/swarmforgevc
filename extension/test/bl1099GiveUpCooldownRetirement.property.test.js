'use strict';

// BL-1099 declared invariants (coder first authorship - BL-654):
//
// 1. "Retiring the scenario removes no coverage: for every (cooldown
//    elapsed?, recorded process state) pair the retired scenario could
//    reach, an executable assertion over `check-one!` still exists in the
//    repository after this parcel."
// 2. "No step registration outlives the scenario that used it: after the
//    retirement, every step pattern still registered by the BL-303 handler
//    file is referenced by at least one scenario in some `.feature` file."
//
// Both quantify over feature / handler SOURCE TEXT via the pure helpers in
// specs/pipeline/scripts/bl1099GiveUpCooldownRetirement.js — the same
// module the acceptance steps call. Generator reach: every draw builds a
// corpus that either includes or deliberately drops each matrix cell /
// registration, so uncovered and orphaned states are hit by construction
// (not by hoping a random corpus omits them).
//
// Non-vacuity (staged-first restore, run 2026-08-23, recorded in the parcel
// commit):
//   break 1 - findScenarioCoveringCase always returns "always-covered": RED
//     on the first draw that drops a cell (missingCoverageCases stays []).
//   break 2 - orphanedRegistrations always returns []: RED on the first
//     draw that plants an unreferenced define.
// Both restored byte-for-byte; ALL PROPERTIES HOLD.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  COVERAGE_CASES,
  missingCoverageCases,
  findScenarioCoveringCase,
  orphanedRegistrations,
  extractDefinePatternSources,
} = require('../../specs/pipeline/scripts/bl1099GiveUpCooldownRetirement');

function notElapsedOutline(includeDead, includeAlive) {
  const rows = [];
  if (includeDead) rows.push('| dead          |');
  if (includeAlive) rows.push('| still alive   |');
  if (rows.length === 0) {
    return `
  Scenario: unrelated
    Given nothing about cooldown
    Then something else
`;
  }
  return `
  Scenario Outline: stays down inside cooldown
    Given the give-up cooldown has not yet elapsed
    And the given-up child's recorded process is <process state>
    Then the child is still given up
    And no replacement is spawned
    Examples:
      | process state |
      ${rows.join('\n      ')}
`;
}

function elapsedRearmScenario(include) {
  if (!include) {
    return `
  Scenario: unrelated elapsed chatter
    Given something else
    Then no supervisor decision
`;
  }
  return `
  Scenario: re-arms after cooldown
    Given the give-up cooldown has elapsed
    Then the child is respawned with a fresh restart budget
`;
}

function featureForCoverage({ includeNotElapsedDead, includeNotElapsedAlive, includeElapsed }) {
  return `Feature: generated coverage corpus
${notElapsedOutline(includeNotElapsedDead, includeNotElapsedAlive)}
${elapsedRearmScenario(includeElapsed)}
`;
}

function expectedMissing({ includeNotElapsedDead, includeNotElapsedAlive, includeElapsed }) {
  return COVERAGE_CASES.filter((c) => {
    if (c.elapsed === 'has not elapsed' && c.processState === 'dead') return !includeNotElapsedDead;
    if (c.elapsed === 'has not elapsed' && c.processState === 'still alive') return !includeNotElapsedAlive;
    if (c.elapsed === 'has elapsed') return !includeElapsed;
    return false;
  });
}

test('BL-1099/BL-654 invariant 1: every matrix cell is covered exactly when the corpus asserts it', () => {
  fc.assert(
    fc.property(
      fc.record({
        includeNotElapsedDead: fc.boolean(),
        includeNotElapsedAlive: fc.boolean(),
        includeElapsed: fc.boolean(),
      }),
      (flags) => {
        const feature = featureForCoverage(flags);
        const missing = missingCoverageCases([feature]);
        const expected = expectedMissing(flags);
        assert.deepEqual(
          missing.map((c) => `${c.elapsed}|${c.processState}`).sort(),
          expected.map((c) => `${c.elapsed}|${c.processState}`).sort()
        );
        for (const cell of COVERAGE_CASES) {
          const found = findScenarioCoveringCase([feature], cell.elapsed, cell.processState);
          const shouldFind = !expected.some(
            (e) => e.elapsed === cell.elapsed && e.processState === cell.processState
          );
          if (shouldFind) assert.ok(found, `expected coverage for ${cell.elapsed}/${cell.processState}`);
          else assert.equal(found, null);
        }
      }
    ),
    { numRuns: 64 }
  );
});

function handlerWithPatterns(patterns) {
  return patterns.map((p) => `registry.define(/^${p}$/, () => {});`).join('\n');
}

function featureCiting(fragments) {
  return `Feature: cites
  Scenario: uses them
${fragments.map((f) => `    Given ${f}`).join('\n')}
`;
}

test('BL-1099/BL-654 invariant 2: a registration is orphaned exactly when no feature cites it', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(
        fc.stringMatching(/^[a-z]+(?: [a-z]+){2,5}$/),
        { minLength: 1, maxLength: 5 }
      ),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
      (patterns, citeFlags) => {
        const flags = patterns.map((_, i) => citeFlags[i % citeFlags.length]);
        const handler = handlerWithPatterns(patterns);
        const cited = patterns.filter((_, i) => flags[i]);
        const features = cited.length > 0 ? [featureCiting(cited)] : ['Feature: empty\n'];
        const orphans = orphanedRegistrations(handler, features);
        const expected = patterns.filter((_, i) => !flags[i]);
        assert.deepEqual(orphans.sort(), expected.sort());
        assert.deepEqual(extractDefinePatternSources(handler).sort(), [...patterns].sort());
      }
    ),
    { numRuns: 64 }
  );
});
