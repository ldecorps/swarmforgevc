'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkSharedTmpDir } = require('./helpers/tmpDir');

// BL-1371's three DECLARED invariants (the ticket's `invariants:` block),
// coder-authored per BL-654 and runnable only via `npm run test:properties`
// (vitest.properties.config.mjs), so the unit lane, coverage and mutation
// never collect them.
//
//   P1 "The set of handlers loaded after this change equals or contains the
//       set loaded today, compared as a SET of handler identities and never
//       as a count - a scenario that silently loses its handler is the one
//       outcome worse than the coupling."
//   P2 "A handler file that cannot be loaded fails the run loudly, naming the
//       file; discovery never silently skips what it could not require."
//   P3 "Registering a new handler requires editing no file that another ticket
//       also edits - a design that keeps any shared list has not delivered
//       this ticket."
//
// The real registry module (specs/pipeline/steps/index.js) is driven over
// FIXTURE steps directories, never this repository's own: requiring the live
// one loads ~940 handler modules, several of which import node:test and
// derail Vitest's collection (see helpers/stepCollisionGuard.js). A COPY in a
// fixture directory loads only that directory's handlers, because its eager
// load defaults to its own __dirname - so these properties run the real
// implementation, not a restatement of it.
//
// GENERATOR REACH is asserted, never hoped for (BL-654). Each property
// records which cells its draws actually landed in and asserts a floor,
// because the two known failure shapes both look like a passing property:
//  - P1's discriminator is a count-blind one. A draw where the number of real
//    handlers happens to differ from the number of decoys is passed by an
//    implementation that only counts, so the generator CONSTRUCTS equal-sized
//    (handlers, decoys) draws rather than hoping to sample one - see
//    `EQUAL_SIZED_FLOOR`.
//  - P2's discriminator is POSITION. A loader that stopped collecting after
//    the first file, or that swallowed anything after it, is caught only by a
//    broken file drawn late in sorted order, so the offending position is a
//    fixed iterated cell rather than a random one.
//
// NON-VACUITY, checked by hand against deliberately broken implementations of
// specs/pipeline/steps/index.js and then restored (recorded in
// backlog/evidence/BL-1371-coder-pass-20260903.md):
//  - filtering with `.includes('Steps')` instead of `.endsWith(HANDLER_SUFFIX)`
//    fails P1 (a `...StepsHelper.js` decoy is loaded);
//  - a recursive readdir fails P1 (a lib/ helper is loaded);
//  - `try { require(file) } catch { return null }` in loadHandler fails P2;
//  - dropping the file name from the wrapper message fails P2's naming half
//    while its "fails the run" half still passes, which is what makes the two
//    halves independent rather than one assertion written twice;
//  - reintroducing a hand-maintained array (discovery filtered down to a
//    hardcoded list of names) fails ALL THREE - P1 loses the handlers the
//    list omits, P3's newly added file never registers, and P2 stops failing
//    loudly because the broken file is filtered out before it is required.
//    That last one is worth noting: the array's failure mode and the
//    silent-skip failure mode are the same defect seen from two sides.
// Restoring the real implementation passes all three again.

const REAL_REGISTRY = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'index.js');
const REAL_STEP_REGISTRY = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'stepRegistry.js');
const { createStepRegistry } = require(REAL_STEP_REGISTRY);

const RUNS = 120;
const EQUAL_SIZED_FLOOR = 20;
const POSITION_FLOOR = 8;

let root;
let seq = 0;

beforeAll(() => {
  root = mkSharedTmpDir('bl1371-props-');
});

afterAll(() => {
  if (root) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** A fresh steps directory carrying a copy of the real registry plus `files`. */
function plant(files) {
  const stepsDir = path.join(root, `steps${(seq += 1)}`);
  fs.mkdirSync(stepsDir, { recursive: true });
  const registryPath = path.join(stepsDir, 'index.js');
  fs.copyFileSync(REAL_REGISTRY, registryPath);
  for (const [name, source] of Object.entries(files)) {
    const full = path.join(stepsDir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source, 'utf8');
  }
  return { stepsDir, registryPath };
}

function handlerSource(pattern) {
  return [
    "'use strict';",
    'function registerSteps(registry) {',
    `  registry.define(/^${pattern}$/, () => ${JSON.stringify(pattern)});`,
    '}',
    'module.exports = { registerSteps };',
    '',
  ].join('\n');
}

function loadedNames(registryPath, stepsDir) {
  return require(registryPath)
    .discoverHandlerFiles(stepsDir)
    .map((file) => path.basename(file))
    .sort();
}

function registeredPatterns(registryPath) {
  const registry = createStepRegistry();
  require(registryPath).registerSteps(registry);
  return registry
    .listDefinitions()
    .map((d) => d.pattern.source)
    .sort();
}

const stemArb = fc
  .tuple(fc.constantFrom('a', 'b', 'c', 'm', 'x', 'y', 'z', 'bl1', 'bl99', 'zz'), fc.integer({ min: 0, max: 9999 }))
  .map(([prefix, n]) => `${prefix}${n}`);

// ── P1: the loaded set is EXACTLY the discoverable set, as a set ───────────
//
// "Equals or contains the set loaded today" is encoded as the strongest form
// available on a fixture: every file that CAN be a handler is loaded, and
// nothing else is. Losing one member is the outcome the invariant calls worse
// than the coupling; inventing one (a lib helper, a focused entry point) is
// how the old array's `*Only.js` exclusion would be silently undone.
test('P1 every discoverable handler is loaded and nothing else is, compared as a set', () => {
  const reach = { equalSized: 0, noHandlers: 0, withSubdir: 0 };
  fc.assert(
    fc.property(
      // The handler and decoy stems are drawn to the SAME length, so the two
      // sets are equal-sized by construction and a count-based check cannot
      // tell a correct implementation from one that loads the decoys instead.
      fc
        .uniqueArray(stemArb, { minLength: 0, maxLength: 5 })
        .chain((handlers) =>
          fc.record({
            handlers: fc.constant(handlers),
            decoys: fc.uniqueArray(stemArb, {
              minLength: handlers.length,
              maxLength: handlers.length,
            }),
            decoyShape: fc.constantFrom('Only.js', 'Helper.js', 'StepsHelper.js', '.js', 'Steps.txt'),
            subdir: fc.constantFrom('lib', 'helpers', ''),
          })
        ),
      ({ handlers, decoys, decoyShape, subdir }) => {
        const files = {};
        const expected = [];
        for (const stem of handlers) {
          files[`${stem}Steps.js`] = handlerSource(`${stem} step`);
          expected.push(`${stem}Steps.js`);
        }
        for (const stem of decoys) {
          // A decoy is never allowed to collide with a real handler's name.
          const name = `${stem}Decoy${decoyShape}`;
          files[name] = handlerSource(`${stem} decoy step`);
        }
        if (subdir) {
          // A file that WOULD be discovered if discovery recursed: same
          // suffix, one directory down. lib/androidJvmDecisionSteps.js is
          // exactly this shape in the live tree.
          files[`${subdir}/nestedSteps.js`] = handlerSource('nested step');
          reach.withSubdir += 1;
        }
        if (handlers.length === decoys.length) {
          reach.equalSized += 1;
        }
        if (handlers.length === 0) {
          reach.noHandlers += 1;
        }

        const { stepsDir, registryPath } = plant(files);
        assert.deepEqual(
          loadedNames(registryPath, stepsDir),
          [...expected].sort(),
          'the loaded set is not exactly the set of discoverable handler files'
        );
        assert.deepEqual(
          registeredPatterns(registryPath),
          handlers.map((stem) => `^${stem} step$`).sort(),
          'the registered patterns are not exactly the discovered handlers\' own'
        );
      }
    ),
    { numRuns: RUNS }
  );
  assert.ok(
    reach.equalSized >= EQUAL_SIZED_FLOOR,
    `reach floor: only ${reach.equalSized} draws had as many decoys as handlers - a count-based implementation would survive this run`
  );
  assert.ok(reach.noHandlers >= 1, 'reach floor: no draw had zero handlers');
  assert.ok(
    reach.withSubdir >= EQUAL_SIZED_FLOOR,
    `reach floor: only ${reach.withSubdir} draws planted a nested *Steps.js - a recursive implementation would survive this run`
  );
  console.log(`BL-1371 P1 reach over ${RUNS} draws:`, JSON.stringify(reach));
});

// ── P2: a file that cannot be required fails loudly, by name ───────────────
//
// The offending POSITION is an iterated cell rather than a drawn one: a loader
// that stops collecting after the first file, or swallows anything after it,
// is only caught by a broken file that sorts late.
const BREAK_SHAPES = {
  throws: "'use strict';\nthrow new Error('bl1371 fixture: refuses to load');\n",
  'syntax-error': "'use strict';\nfunction registerSteps( {\n",
  'missing-require': "'use strict';\nrequire('./bl1371-nowhere-at-all');\n",
  'throwing-lib': "'use strict';\nrequire('./lib/bl1371BrokenLib');\n",
};
const POSITIONS = ['first', 'middle', 'last'];

test('P2 a handler that cannot be required fails the load, naming the file, wherever it sits', () => {
  const reach = { shape: {}, position: {} };
  for (const shape of Object.keys(BREAK_SHAPES)) {
    for (const position of POSITIONS) {
      fc.assert(
        fc.property(
          fc.record({
            shape: fc.constant(shape),
            position: fc.constant(position),
            siblings: fc.integer({ min: 1, max: 4 }),
          }),
          ({ siblings }) => {
            reach.shape[shape] = (reach.shape[shape] || 0) + 1;
            reach.position[position] = (reach.position[position] || 0) + 1;

            // Sorted names m1..mN with the broken file's name chosen so it
            // sorts into the required position.
            const files = {};
            for (let i = 1; i <= siblings; i += 1) {
              files[`m${i}Steps.js`] = handlerSource(`m${i} step`);
            }
            const brokenName =
              position === 'first' ? 'aBrokenSteps.js' : position === 'last' ? 'zBrokenSteps.js' : 'm0zBrokenSteps.js';
            files[brokenName] = BREAK_SHAPES[shape];
            if (shape === 'throwing-lib') {
              files['lib/bl1371BrokenLib.js'] = "'use strict';\nthrow new Error('bl1371 fixture: the lib refuses');\n";
            }

            const { registryPath } = plant(files);
            let failure;
            try {
              require(registryPath);
            } catch (err) {
              failure = err;
            }
            assert.ok(
              failure,
              `a ${shape} handler at ${position} loaded clean - discovery silently skipped what it could not require`
            );
            const text = `${failure.message}\n${failure.stack || ''}`;
            assert.ok(
              text.includes(brokenName),
              `the failure did not NAME ${brokenName} (${shape}, ${position}):\n${text}`
            );
            if (shape === 'throwing-lib') {
              // The naming must reach through the require chain: the module
              // that actually failed is the lib, and both names matter.
              assert.ok(
                text.includes('bl1371BrokenLib'),
                `the failure named the handler but lost the lib module that broke it:\n${text}`
              );
            }
          }
        ),
        { numRuns: Math.ceil(RUNS / (Object.keys(BREAK_SHAPES).length * POSITIONS.length)) }
      );
    }
  }
  for (const shape of Object.keys(BREAK_SHAPES)) {
    assert.ok(
      (reach.shape[shape] || 0) >= POSITION_FLOOR,
      `reach floor: shape ${shape} drawn ${reach.shape[shape] || 0} < ${POSITION_FLOOR}`
    );
  }
  for (const position of POSITIONS) {
    assert.ok(
      (reach.position[position] || 0) >= POSITION_FLOOR,
      `reach floor: position ${position} drawn ${reach.position[position] || 0} < ${POSITION_FLOOR}`
    );
  }
  console.log('BL-1371 P2 reach:', JSON.stringify(reach));
});

// ── P3: registering a new handler edits no shared file ─────────────────────
//
// The new handler's name is drawn to sort BEFORE, BETWEEN and AFTER the
// existing ones, because "you may only append" is precisely the constraint a
// hand-maintained list imposes and an append-only draw would never see.
test('P3 adding only the handler file registers it, and the registry file is untouched', () => {
  const reach = { before: 0, between: 0, after: 0 };
  const shipped = fs.readFileSync(REAL_REGISTRY);
  fc.assert(
    fc.property(
      fc.record({
        existing: fc.uniqueArray(fc.constantFrom('m1', 'm2', 'm3', 'm4', 'm5'), { minLength: 1, maxLength: 5 }),
        where: fc.constantFrom('before', 'between', 'after'),
        n: fc.integer({ min: 0, max: 9999 }),
      }),
      ({ existing, where, n }) => {
        reach[where] += 1;
        const files = {};
        for (const stem of existing) {
          files[`${stem}Steps.js`] = handlerSource(`${stem} step`);
        }
        const newStem = where === 'before' ? `a${n}` : where === 'after' ? `z${n}` : `m2a${n}`;
        const newName = `${newStem}Steps.js`;

        // Step one: the tree WITHOUT the new handler. Its pattern must not
        // resolve - otherwise the second half proves nothing.
        const before = plant(files);
        assert.ok(
          !registeredPatterns(before.registryPath).includes(`^${newStem} step$`),
          'the new handler resolved before it was added'
        );

        // Step two: the SAME tree plus exactly one new file, and nothing else.
        files[newName] = handlerSource(`${newStem} step`);
        const after = plant(files);
        assert.ok(
          registeredPatterns(after.registryPath).includes(`^${newStem} step$`),
          `adding ${newName} did not register its steps`
        );
        assert.ok(
          loadedNames(after.registryPath, after.stepsDir).includes(newName),
          `${newName} is not in the loaded set`
        );
        // No shared file was edited: the registry module in the tree that
        // registers the new handler is byte-identical to this repository's
        // shipped one, and never mentions the handler.
        assert.deepEqual(
          fs.readFileSync(after.registryPath),
          shipped,
          'registering the new handler required editing the registry module'
        );
        assert.ok(
          !shipped.toString('utf8').includes(newStem),
          'the shipped registry module names the new handler'
        );
        // And the only difference between the two trees is that one file.
        const beforeFiles = fs.readdirSync(before.stepsDir).sort();
        const afterFiles = fs.readdirSync(after.stepsDir).sort();
        assert.deepEqual(
          afterFiles.filter((f) => !beforeFiles.includes(f)),
          [newName],
          'registering the new handler added more than the handler file'
        );
      }
    ),
    { numRuns: RUNS }
  );
  for (const where of ['before', 'between', 'after']) {
    assert.ok(
      reach[where] >= POSITION_FLOOR,
      `reach floor: a name sorting ${where} the existing handlers drawn ${reach[where]} < ${POSITION_FLOOR}`
    );
  }
  console.log('BL-1371 P3 reach:', JSON.stringify(reach));
});
