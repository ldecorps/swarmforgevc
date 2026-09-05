'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { readTree, checkFeatureHandlerRegistration } = require('../out/tools/check-feature-handler-registration');

// BL-1400 declared invariants:
//
// 1. A handler file ANYWHERE under specs/pipeline/steps/ is in the guard's
//    tree: a feature whose only handler is nested is refused as unregistered,
//    naming the handler and the feature - never passed for want of seeing it.
// 2. Legitimate nested files are not offenders: a lib/ helper reached by a
//    discovered handler's require stays reachable, and lib/ files that no
//    handler requires are never reported as unregistered handlers.
//
// The defect was in the TREE BUILDER, not the predicate - readTree listed the
// steps directory flat, so the subdirectory branch of `isDiscovered` could
// never be reached. The generator therefore constructs the nesting rather
// than hoping for it: every draw places the handler at a generated DEPTH,
// and depth 0 (the passing placement) is drawn as often as the nested ones so
// the property distinguishes them rather than asserting one shape twice.
//
// Runs ONLY via `npm run test:properties`.

const STEPS = 'specs/pipeline/steps';

function io(files) {
  const paths = Object.keys(files);
  const written = [];
  return {
    written,
    listDir: (dir) => paths.filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1)),
    listTree: (dir) => paths.filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)),
    readFile: (p) => (p in files ? files[p] : null),
    write: (text) => written.push(text),
  };
}

const segment = fc.constantFrom('nested', 'deep', 'sub', 'extra');

test('property: a handler at any depth under the steps directory is in the tree, and only the top-level one passes', () => {
  const depths = new Set();
  fc.assert(
    fc.property(
      fc.integer({ min: 9000, max: 9999 }),
      fc.array(segment, { minLength: 0, maxLength: 3 }),
      (ticketNumber, dirs) => {
        depths.add(dirs.length);
        const feature = `specs/features/BL-${ticketNumber}-x.feature`;
        const handlerName = `bl${ticketNumber}XSteps.js`;
        const handler = [STEPS, ...dirs, handlerName].join('/');
        const deps = io({
          [feature]: `Feature: x ${ticketNumber}`,
          [`${STEPS}/index.js`]: 'const DOMAINS = [];',
          [handler]: 'module.exports = { registerSteps() {} };',
        });

        // Invariant 1, first half: the handler is IN the tree whatever its depth.
        assert.equal(readTree(deps).stepFiles.includes(handler), true, `the tree lost ${handler}`);

        const status = checkFeatureHandlerRegistration(deps);
        if (dirs.length === 0) {
          assert.equal(status, 0, `a top-level handler must pass:\n${deps.written.join('')}`);
          return;
        }
        // Invariant 1, second half: refused, naming BOTH.
        assert.equal(status, 1, 'a nested handler must be refused');
        const refusal = deps.written.join('');
        assert.ok(refusal.includes(handler), `refusal does not name the handler:\n${refusal}`);
        assert.ok(refusal.includes(feature), `refusal does not name the feature:\n${refusal}`);
      }
    ),
    { numRuns: 200 }
  );
  // Reach, asserted: the passing depth AND every nested depth were drawn.
  assert.deepEqual([...depths].sort(), [0, 1, 2, 3]);
});

test('property: a lib helper is never an offender, whether or not a handler requires it', () => {
  const seen = new Set();
  fc.assert(
    fc.property(
      fc.integer({ min: 9000, max: 9999 }),
      fc.boolean(),
      fc.array(segment, { minLength: 0, maxLength: 2 }),
      (ticketNumber, required, libDirs) => {
        seen.add(`${required}|${libDirs.length}`);
        // The helper is named for the SAME ticket the feature declares - the
        // file that would look like that feature's handler to a check keyed
        // on the ticket id. Constructed, never hoped for.
        const helper = [`${STEPS}/lib`, ...libDirs, `bl${ticketNumber}XHelper.js`].join('/');
        const handler = `${STEPS}/bl${ticketNumber}XSteps.js`;
        const requireLine = required ? `require('${helper.replace(`${STEPS}/`, './')}');\n` : '';
        const deps = io({
          [`specs/features/BL-${ticketNumber}-x.feature`]: 'Feature: x',
          [`${STEPS}/index.js`]: 'const DOMAINS = [];',
          [handler]: `${requireLine}module.exports = { registerSteps() {} };`,
          [helper]: 'module.exports = {};',
        });
        // A helper is a lib file, never a step file.
        const tree = readTree(deps);
        assert.equal(tree.stepFiles.includes(helper), false, `${helper} entered stepFiles`);
        assert.equal(tree.libFiles.includes(helper), true, `${helper} is missing from libFiles`);
        assert.equal(checkFeatureHandlerRegistration(deps), 0, `a lib helper was refused:\n${deps.written.join('')}`);
      }
    ),
    { numRuns: 200 }
  );
  // Reach: required and unrequired, at the top of lib/ and nested inside it.
  assert.deepEqual([...seen].sort(), ['false|0', 'false|1', 'false|2', 'true|0', 'true|1', 'true|2']);
});
