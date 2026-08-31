'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { assessFeatureHandlerRegistration } = require('../out/tools/featureHandlerRegistrationCheck');
const { formatFeatureHandlerRefusal } = require('../out/tools/featureHandlerRegistrationReport');
const { REGISTRY_PATH } = require('../out/tools/featureHandlerRegistrationTypes');

// BL-1303's two declared invariants (backlog/active/BL-1303-...yaml), encoded
// on the pure assessor the guard delegates to. Coder-authored per BL-654;
// runs ONLY via `npm run test:properties` (vitest.properties.config.mjs), so
// the unit lane, coverage and mutation never collect it.
//
//   P1 "The guard fails closed: an artifact it cannot resolve or read is a
//       refusal naming it, never a silent pass."
//   P2 "One pass reports every offending artifact, not only the first."
//
// Non-vacuity, checked by hand against deliberately broken implementations
// and restored:
//  - making walkRegistry return `{reachable, registryReadable:false}` on an
//    unreadable registry WITHOUT pushing the offender fails P1 on its first
//    unreadable-registry case;
//  - making the missing-module branch `continue` without pushing fails P1 on
//    its first vanished-module case;
//  - making the feature loop `break` after the first offending feature fails
//    P2's every-feature-named assertion (P1 still passes, which is what makes
//    the two properties independent rather than one assertion written twice).
// Restoring the real implementation passes all of them again.

const STEPS = 'specs/pipeline/steps';

function tree(files) {
  const paths = Object.keys(files);
  return {
    featureFiles: paths.filter((p) => p.startsWith('specs/features/') && p.endsWith('.feature')),
    stepFiles: paths.filter((p) => /^specs\/pipeline\/steps\/[^/]+\.js$/.test(p)),
    libFiles: paths.filter((p) => p.startsWith(`${STEPS}/lib/`)),
    readFile: (p) => (p in files ? files[p] : null),
  };
}

function registry(modules) {
  return `const DOMAINS = [\n${modules.map((m) => `  require('./${m}'),`).join('\n')}\n];\n`;
}

/** The tree the incident produced, parameterised: n tickets, each in one of the broken shapes. */
const ticketArb = fc.record({
  n: fc.integer({ min: 1, max: 9 }),
  shape: fc.constantFrom('registered', 'unregistered', 'vanished', 'unreadable-handler'),
});

const treeArb = fc
  .uniqueArray(ticketArb, { minLength: 1, maxLength: 6, selector: (t) => t.n })
  .chain((tickets) =>
    fc.record({
      tickets: fc.constant(tickets),
      registryReadable: fc.boolean(),
    })
  );

function buildTree({ tickets, registryReadable }) {
  const files = {};
  const required = [];
  const expectedUnreadable = [];
  const expectedFeatures = [];
  for (const { n, shape } of tickets) {
    const handler = `bl${n}FixtureSteps`;
    const handlerPath = `${STEPS}/${handler}.js`;
    files[`specs/features/BL-${n}-fixture.feature`] = `Feature: fixture ${n}`;
    if (shape === 'registered') {
      files[handlerPath] = 'module.exports = {};';
      required.push(handler);
    } else if (shape === 'unregistered') {
      files[handlerPath] = 'module.exports = {};';
      if (registryReadable) {
        expectedFeatures.push(`specs/features/BL-${n}-fixture.feature`);
      }
    } else if (shape === 'vanished') {
      required.push(handler);
      if (registryReadable) {
        expectedUnreadable.push(handlerPath);
      }
    } else {
      files[handlerPath] = null; // present in the listing, unreadable
      required.push(handler);
      if (registryReadable) {
        expectedUnreadable.push(handlerPath);
      }
    }
  }
  files[REGISTRY_PATH] = registryReadable ? registry(required) : null;
  if (!registryReadable) {
    expectedUnreadable.push(REGISTRY_PATH);
  }
  return { files, expectedUnreadable, expectedFeatures };
}

// ── P1: an artifact it cannot resolve or read is a refusal naming it ────────
test('P1 every artifact the assessor cannot resolve or read is named in the refusal', () => {
  let sawUnreadable = 0;
  fc.assert(
    fc.property(treeArb, (spec) => {
      const { files, expectedUnreadable } = buildTree(spec);
      const offenders = assessFeatureHandlerRegistration(tree(files));
      const text = formatFeatureHandlerRefusal(offenders);
      if (expectedUnreadable.length > 0) {
        sawUnreadable += 1;
        assert.ok(offenders.length > 0, 'an unresolvable artifact was waved through');
      }
      for (const artifact of expectedUnreadable) {
        assert.ok(
          offenders.some((o) => o.path === artifact),
          `unresolvable artifact not reported: ${artifact}`
        );
        assert.ok(text.includes(artifact), `refusal did not name ${artifact}`);
      }
      return true;
    }),
    { numRuns: 300 }
  );
  // Reachability floor, asserted rather than hoped for: a generator that
  // never built an unresolvable artifact would pass P1 vacuously.
  assert.ok(sawUnreadable >= 50, `generator reached only ${sawUnreadable} unresolvable trees`);
});

// ── P2: one pass reports EVERY offender, not only the first ─────────────────
test('P2 one pass reports every offending artifact', () => {
  let sawMultiple = 0;
  fc.assert(
    fc.property(treeArb, (spec) => {
      const { files, expectedUnreadable, expectedFeatures } = buildTree(spec);
      const offenders = assessFeatureHandlerRegistration(tree(files));
      const expectedCount = expectedUnreadable.length + expectedFeatures.length;
      if (expectedCount > 1) {
        sawMultiple += 1;
      }
      assert.ok(
        offenders.length >= expectedCount,
        `${expectedCount} offenders expected, ${offenders.length} reported`
      );
      const text = formatFeatureHandlerRefusal(offenders);
      for (const feature of expectedFeatures) {
        assert.ok(
          offenders.some((o) => o.feature === feature),
          `offending feature not reported: ${feature}`
        );
        assert.ok(text.includes(feature), `refusal did not name ${feature}`);
      }
      for (const artifact of expectedUnreadable) {
        assert.ok(text.includes(artifact), `refusal did not name ${artifact}`);
      }
      return true;
    }),
    { numRuns: 300 }
  );
  assert.ok(sawMultiple >= 50, `generator reached only ${sawMultiple} multi-offender trees`);
});

// ── the count the refusal states is the number of offenders it lists ────────
test('P2 the stated count matches the offenders listed', () => {
  fc.assert(
    fc.property(treeArb, (spec) => {
      const offenders = assessFeatureHandlerRegistration(tree(buildTree(spec).files));
      const text = formatFeatureHandlerRefusal(offenders);
      if (offenders.length === 0) {
        assert.equal(text, '');
        return true;
      }
      assert.ok(text.includes(`${offenders.length} offending artifact(s)`));
      const listed = text.split('\n').filter((line) => line.startsWith('  - '));
      assert.equal(listed.length, offenders.length);
      return true;
    }),
    { numRuns: 200 }
  );
});
