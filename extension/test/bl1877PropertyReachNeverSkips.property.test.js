'use strict';

// BL-1877 declared invariant (coder first authorship - BL-654):
//   "A property file the staged change reaches is never skipped at the
//    commit; when the guard cannot compute the reach it runs the whole lane."
//
// Generator: a random require DAG over compiled out/ modules (a module may
// only require lower-numbered ones), property files requiring random
// modules, and a staged module DERIVED from one property file's own require
// closure, so every draw has at least one file that must be reached (the
// collision is built, not hoped for). Oracle: the transitive closure,
// computed independently. computeReach must answer a superset, or ALL.
//
// Non-vacuity: with computeReach's reverse-graph walk cut to direct
// importers only (queue.push(dep) removed), the transitive draws fail.
// Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');

const { computeReach } = require('../../swarmforge/scripts/property_reach.js');

const graph = fc
  .integer({ min: 2, max: 8 })
  .chain((n) =>
    fc.record({
      n: fc.constant(n),
      deps: fc.tuple(...Array.from({ length: n }, (_, i) => fc.subarray([...Array(i).keys()]))),
      props: fc.array(fc.subarray([...Array(n).keys()], { minLength: 1 }), { minLength: 1, maxLength: 5 }),
      pick: fc.nat(),
    })
  );

function closure(deps, start) {
  const seen = new Set();
  const stack = [...start];
  while (stack.length) {
    const m = stack.pop();
    if (seen.has(m)) continue;
    seen.add(m);
    stack.push(...deps[m]);
  }
  return seen;
}

test('BL-1877/BL-654 invariant: a reached property file is never skipped', () => {
  let transitive = 0;
  let answered = 0;
  fc.assert(
    fc.property(graph, ({ n, deps, props, pick }) => {
      const root = mkTmpDir('bl1877prop-');
      const w = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
      };
      w('extension/vitest.properties.config.mjs', 'export default {};\n');
      for (let i = 0; i < n; i += 1) {
        w(`extension/src/m${i}.ts`, 'x\n');
        w(`extension/out/m${i}.js`, deps[i].map((d) => `require('./m${d}');`).join('\n') + '\n');
      }
      props.forEach((reqs, j) => {
        w(`extension/test/p${j}.property.test.js`, reqs.map((r) => `require('../out/m${r}');`).join('\n') + '\n');
      });
      // Derive the staged module from a property file's own closure.
      const owner = props[pick % props.length];
      const reachable = [...closure(deps, owner)];
      const staged = reachable[pick % reachable.length];
      const expected = props
        .map((reqs, j) => (closure(deps, reqs).has(staged) ? `test/p${j}.property.test.js` : null))
        .filter(Boolean);
      if (!owner.includes(staged)) transitive += 1;

      const got = computeReach(root, [`extension/src/m${staged}.ts`]);
      if (got === null) return; // ALL: the guard runs the whole lane - allowed.
      answered += 1;
      const rel = new Set(got.map((p) => path.relative(path.join(root, 'extension'), p)));
      for (const e of expected) assert.ok(rel.has(e), `${e} reaches m${staged} but was skipped (got ${[...rel]})`);
    }),
    { numRuns: 60 }
  );
  // Reach floor: the draws exercised transitive reach, and the answers were
  // real reaches rather than a blanket ALL.
  assert.ok(transitive >= 5, `transitive draws: ${transitive}`);
  assert.ok(answered >= 50, `non-ALL answers: ${answered}`);
});
