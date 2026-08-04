'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');
const { findUnresolvedSteps, exampleCases } = require('../../specs/pipeline/scripts/resolve_contract_steps');
const { createStepRegistry } = require('../../specs/pipeline/stepRegistry');
const { scenarioSteps, substitute } = require('../../specs/pipeline/runtime');

// BL-761 declared invariants (backlog/active/BL-761-acceptance-contract-that-cannot-run-reaches-qa.yaml):
// 1. The gate's verdict comes from the same parser and step registry the
//    acceptance runner itself uses; it never reimplements Gherkin parsing
//    or step matching.
// 2. A contract passes only when every scenario's every step resolves,
//    including every Scenario Outline row after example substitution; a
//    step is never skipped, sampled, or assumed matched.
// 3. An acceptance declaration that cannot be read - absent, inline-only,
//    or naming a missing file - fails CLOSED, while an infrastructure
//    failure that prevents the check from running at all fails OPEN with
//    a warning.
//
// Invariant 1 has NO property-test encoding here (coder-authored stated
// reason, per BL-654's "admits no executable encoding" exception, same
// shape as pilotAcceptanceGate.property.test.js's own invariant 2): it
// constrains IMPLEMENTATION STRATEGY - resolve_contract_steps.js requires
// and drives specs/pipeline/stepRegistry.js's resolve() and
// specs/pipeline/runtime.js's substitute()/scenarioSteps() (the requires
// at the top of this very file; resolveContractSteps.test.js covers that
// wiring directly) rather than reimplementing pattern matching - not a
// property of varying input/output. There is no data space to quantify a
// generator over; it is checked by code review of which module owns
// matching, not by varying inputs to a pure function.
//
// Invariants 2 and 3 below are coder-authored property tests per BL-654;
// this file runs only via `npm run test:properties`.

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// shape: [{numRows, numSteps}, ...] one entry per scenario. Every step's
// substituted text is unique per (scenarioIndex, exampleIndex-or-null,
// stepIndex) address, computed WITHOUT running substitute() (substitute is
// exercised for real inside findUnresolvedSteps itself) so the test can
// independently predict what the checker should see.
function buildFeatureAndAddresses(shape) {
  const scenarios = shape.map((s, scenarioIndex) => {
    const steps = Array.from({ length: s.numSteps }, (_, stepIndex) => ({
      keyword: 'Given',
      text: `step <n>-${scenarioIndex}-${stepIndex}`,
    }));
    const examples = s.numRows > 0 ? Array.from({ length: s.numRows }, (_, rowIndex) => ({ n: String(rowIndex) })) : undefined;
    return { name: `scenario-${scenarioIndex}`, steps, examples };
  });
  const feature = { name: 'property fixture', background: [], scenarios };

  const addresses = [];
  scenarios.forEach((scenario, scenarioIndex) => {
    for (const { exampleIndex, row } of exampleCases(scenario)) {
      scenario.steps.forEach((step, stepIndex) => {
        addresses.push({
          scenarioIndex,
          scenarioName: scenario.name,
          exampleIndex,
          stepIndex,
          finalText: substitute(step.text, row),
        });
      });
    }
  });
  return { feature, addresses };
}

// property: for ANY scenario/example-row/step shape, a step planted as
// unresolvable at an ARBITRARY address (including the last scenario's last
// row's last step) is found, and ONLY that one - never skipped, sampled, or
// silently assumed matched.
test('property: invariant 2 - an unresolvable step is found at any address, including the deepest one, and never any other', () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ numRows: fc.constantFrom(0, 2, 3), numSteps: fc.integer({ min: 1, max: 4 }) }), {
        minLength: 1,
        maxLength: 4,
      }),
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.boolean(),
      (shape, rawPick, plantBreak) => {
        const { feature, addresses } = buildFeatureAndAddresses(shape);
        fc.pre(addresses.length > 0);
        const breakIndex = plantBreak ? rawPick % addresses.length : -1;

        const registry = createStepRegistry();
        addresses.forEach((addr, i) => {
          if (i !== breakIndex) {
            registry.define(new RegExp(`^${escapeRegex(addr.finalText)}$`), () => {});
          }
        });

        const found = findUnresolvedSteps(feature, registry, { scenarioSteps, substitute });

        if (breakIndex === -1) {
          assert.deepEqual(found, [], `expected no unresolved steps when every address is registered, got ${JSON.stringify(found)}`);
        } else {
          const expected = addresses[breakIndex];
          assert.deepEqual(
            found,
            [{ scenario: expected.scenarioName, exampleIndex: expected.exampleIndex, stepText: expected.finalText }],
            `expected exactly the planted break at address ${breakIndex} (${JSON.stringify(expected)}), got ${JSON.stringify(found)}`
          );
        }
      }
    ),
    { numRuns: 80 }
  );
});

// Non-vacuous check (BL-654): a checker that only scans the FIRST scenario
// must fail this property whenever the break is planted in a later one.
test('property: invariant 2 sanity - a deliberately truncated scanner (first scenario only) fails this property', () => {
  const shape = [{ numRows: 0, numSteps: 1 }, { numRows: 0, numSteps: 1 }];
  const { feature, addresses } = buildFeatureAndAddresses(shape);
  const breakIndex = addresses.length - 1; // the LAST scenario's step
  const registry = createStepRegistry();
  addresses.forEach((addr, i) => {
    if (i !== breakIndex) registry.define(new RegExp(`^${escapeRegex(addr.finalText)}$`), () => {});
  });

  function truncatedFindUnresolvedSteps(f, r) {
    const first = f.scenarios[0];
    return scenarioSteps(f, first)
      .filter((step) => !r.resolve(substitute(step.text, undefined), f.name))
      .map((step) => ({ scenario: first.name, exampleIndex: null, stepText: substitute(step.text, undefined) }));
  }

  const found = truncatedFindUnresolvedSteps(feature, registry);
  assert.deepEqual(found, [], 'a scanner truncated to the first scenario misses a break planted in the last one');
});

// property: invariant 3's fail-closed/fail-open matrix holds for every
// combination of declaration/registry state - shelled to bb ONCE per
// property run against the real, pure acceptance-contract-gate-lib/evaluate
// (never reimplemented in JS), for ARBITRARY ticket ids and unresolved-step
// counts.
const BB_SCRIPT = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'acceptance_contract_gate_lib.bb');

function ednString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function caseToEdn(c) {
  const steps = Array.from(
    { length: c.unresolvedCount },
    (_, i) => `{:scenario ${ednString('s' + i)} :example-index nil :step-text ${ednString('t' + i)}}`
  ).join(' ');
  return (
    `{:ticket-id ${ednString(c.ticketId)} :declaration-readable? ${c.declarationReadable}` +
    ` :registry-loadable? ${c.registryLoadable}` +
    ` :registry-load-error ${c.registryLoadError === null ? 'nil' : ednString(c.registryLoadError)}` +
    ` :unresolved-steps [${steps}]}`
  );
}

function evaluateAllInBb(cases) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl761-prop-'));
  const casesPath = path.join(tmp, 'cases.edn');
  const outPath = path.join(tmp, 'out.txt');
  fs.writeFileSync(casesPath, `[${cases.map(caseToEdn).join(' ')}]`);
  const expr = [
    `(load-file "${BB_SCRIPT}")`,
    `(require '[clojure.edn :as edn])`,
    `(let [cases (edn/read-string (slurp "${casesPath}"))`,
    `      results (mapv (fn [c] (let [r (acceptance-contract-gate-lib/evaluate c)]`,
    `                               [(count (:findings r)) (count (:warnings r))]))`,
    `                    cases)]`,
    `  (spit "${outPath}" (clojure.string/join "\\n" (map (fn [[f w]] (str f "," w)) results))))`,
  ].join(' ');
  execFileSync('bb', ['-e', expr], { encoding: 'utf8' });
  const out = fs.readFileSync(outPath, 'utf8');
  fs.rmSync(tmp, { recursive: true, force: true });
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [findings, warnings] = line.split(',').map(Number);
      return { findings, warnings };
    });
}

test('property: invariant 3 - unreadable declaration always fails closed (1 finding, 0 warnings); readable+loadable yields exactly N findings for N unresolved steps and 0 warnings; readable+unloadable always fails open (0 findings, 1 warning)', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          ticketId: fc.stringMatching(/^BL-[0-9]{1,4}$/),
          declarationReadable: fc.boolean(),
          registryLoadable: fc.boolean(),
          registryLoadError: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
          unresolvedCount: fc.integer({ min: 0, max: 4 }),
        }),
        { minLength: 1, maxLength: 8 }
      ),
      (cases) => {
        const results = evaluateAllInBb(cases);
        assert.equal(results.length, cases.length, `expected ${cases.length} results, got ${results.length}`);

        cases.forEach((c, i) => {
          const { findings, warnings } = results[i];
          if (!c.declarationReadable) {
            assert.equal(findings, 1, `case ${i} (declaration unreadable): expected 1 finding, got ${findings}`);
            assert.equal(warnings, 0, `case ${i} (declaration unreadable): expected 0 warnings, got ${warnings}`);
          } else if (!c.registryLoadable) {
            assert.equal(findings, 0, `case ${i} (registry unloadable): expected 0 findings, got ${findings}`);
            assert.equal(warnings, 1, `case ${i} (registry unloadable): expected 1 warning, got ${warnings}`);
          } else {
            assert.equal(
              findings,
              c.unresolvedCount,
              `case ${i} (readable+loadable): expected ${c.unresolvedCount} findings, got ${findings}`
            );
            assert.equal(warnings, 0, `case ${i} (readable+loadable): expected 0 warnings, got ${warnings}`);
          }
        });
      }
    ),
    { numRuns: 25 }
  );
});
