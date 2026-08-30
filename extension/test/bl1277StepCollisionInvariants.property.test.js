'use strict';

// BL-1277's two declared invariants, coder-authored (BL-654), in the property
// lane (`npm run test:properties`) and never in the unit/coverage/mutation
// lanes.
//
// Invariant 1 - "For every feature, each of its steps resolves to a handler
// registered by that feature's own step file - never to another file's
// unscoped registration - whatever order the step files load in."
//
//   Encoded as order-independence over the REAL registry, because that is the
//   invariant's "whatever order the step files load in" clause: an unscoped
//   registration two files share is answered by whichever loads first, so the
//   defect IS a resolution that changes when steps/index.js is reordered, and
//   its absence IS a resolution that does not. Every draw uses the real
//   createStepRegistry() and the real resolve() the acceptance runner calls
//   (specs/pipeline/scripts/resolve_contract_steps.js), replaying the shipped
//   registrations in a permuted file order.
//
//   Reach BY CONSTRUCTION, not by hope, on both sides:
//     - the corpus is the AMBIGUOUS one (a step text more than one step file
//       has a matching pattern for) and it is checked EXHAUSTIVELY. Sampling
//       it was tried first and was worthless: with a real collision put back
//       (burndownEtaSteps un-scoped again) 60 draws over ~1270 entries stayed
//       green, because ~3 entries are affected. Exhaustive over a finite
//       enumerable domain is strictly stronger than drawing from it;
//     - because the sweep in this parcel leaves NO order-flippable resolution
//       behind, the corpus check alone would be green and say nothing. So the
//       second property is a generative SENSITIVITY draw: it derives the
//       offender from a real drawn text (never an independent pair), planting
//       a second file that registers that same text unscoped, and asserts the
//       same check then reports a flip. Green on the corpus is evidence only
//       because the same check is shown red on collisions built from it.
//
//   Out of scope, deliberately, and NOT what a null resolution here means: 34
//   ambiguous (feature, text) pairs resolve to no handler at all under EVERY
//   ordering - a feature using text only other features' step files scope.
//   That is the acceptance-contract gate's domain (BL-761), not this ticket's;
//   order-independence is what is asserted, so a consistently-null resolution
//   is consistent and passes.
//
// Invariant 2 - "The guard's verdict derives from the registry's actual
// registrations (the same stepRegistry.js the acceptance run uses), never from
// a re-implemented scan of step-file source text."
//
//   Encoded adversarially against the re-implementation it forbids: each draw
//   is a step file that a source-text scanner and the real registry DISAGREE
//   about - a file that registers a colliding pattern without the literal
//   `registry.define(` ever appearing in its source (an alias, a loop, a
//   helper, a computed RegExp), and a file whose source is full of
//   `registry.define(` text that registers nothing (a comment, a string). A
//   source-scanning guard gets every one of these backwards; the
//   registry-derived guard gets them all right. Each shape is drawn from its
//   own fc.assert run so the reach floor is met by construction rather than by
//   a uniform draw happening to cover every constant.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkSharedTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor } = require('./helpers/reachFloors');
const { REPO_ROOT, shippedStepFiles, collisionVerdict } = require('./helpers/stepCollisionGuard');

const { createStepRegistry } = require(path.join(REPO_ROOT, 'specs', 'pipeline', 'stepRegistry.js'));

// ── invariant 1 ────────────────────────────────────────────────────────────

// Every registration of every shipped step file, recorded ONCE through the
// real registry, so a draw can replay them into a fresh real registry in any
// file order without paying the require pass again.
function recordShippedRegistrations() {
  return shippedStepFiles().map((file) => {
    const registry = createStepRegistry();
    require(file).registerSteps(registry);
    return { file, entries: registry.listDefinitions() };
  });
}

function buildRegistry(order) {
  const registry = createStepRegistry();
  for (const { entries } of order) {
    for (const { pattern, handler, featureName } of entries) {
      if (featureName) {
        registry.defineScoped(pattern, handler, featureName);
      } else {
        registry.define(pattern, handler);
      }
    }
  }
  return registry;
}

function featureSteps() {
  const dir = path.join(REPO_ROOT, 'specs', 'features');
  const steps = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.feature'))) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    const title = (source.match(/^Feature:\s*(.+)$/m) || [])[1];
    if (!title) {
      continue;
    }
    for (const line of source.split('\n')) {
      const text = line.trim();
      if (/^(Given|When|Then|And|But) /.test(text)) {
        steps.push({ feature: title.trim(), text: text.replace(/^(Given|When|Then|And|But) /, '') });
      }
    }
  }
  return steps;
}

// A step text is AMBIGUOUS when more than one step file has a pattern matching
// it: those, and only those, are the resolutions an ordering could change.
function ambiguousSteps(recorded, steps) {
  const matchers = recorded.map(({ file, entries }) => ({ file, patterns: entries.map((e) => e.pattern) }));
  const seen = new Set();
  const out = [];
  for (const { feature, text } of steps) {
    // BL-1277 architect bounce D1: written as the ESCAPE, never as a literal
    // NUL byte. A raw 0x00 in the source makes git classify the whole file as
    // binary - `git diff` renders it as `Bin 0 -> 15571 bytes` and every later
    // change to it becomes unreviewable - while the runtime value is identical.
    const key = `${feature}\u0000${text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const hits = matchers.filter(({ patterns }) => patterns.some((p) => p.test(text)));
    if (hits.length > 1) {
      out.push({ feature, text, files: hits.map((h) => h.file) });
    }
  }
  return out;
}

// The orderings a first-match scan can tell apart: each candidate file first
// in turn. `null` (no handler for this feature at all) is a resolution like
// any other - what is asserted is that every ordering agrees on it.
//
// Only the files that MATCH the text are replayed. resolve() returns the first
// matching entry, so a file with no matching pattern cannot change the answer
// whatever position it holds - dropping them makes the check exhaustive over
// the whole corpus in seconds instead of sampling a slice of it, and the
// answer is identical to replaying all ~800.
function resolutionsUnderEveryOrdering(byFile, { feature, text, files }, extra) {
  const base = files.map((f) => byFile.get(f));
  const candidates = extra ? [...files, extra.file] : files;
  const pool = extra ? [...base, extra] : base;
  return candidates.map((first) => {
    const head = pool.find((r) => r.file === first);
    const order = [head, ...pool.filter((r) => r.file !== first)];
    const hit = buildRegistry(order).resolve(text, feature);
    return hit ? hit.handler : null;
  });
}

// The corpus must not silently empty out: a property drawing from nothing is
// green and vacuous.
const AMBIGUOUS_FLOOR = 20;
const SENSITIVITY_FLOOR = 10;

describe('BL-1277 invariant 1: step resolution does not depend on step-file load order', () => {
  const recorded = recordShippedRegistrations();
  const ambiguous = ambiguousSteps(recorded, featureSteps());
  const byFile = new Map(recorded.map((r) => [r.file, r]));
  // Two kinds of ambiguous entry are IMMUNE to a planted unscoped duplicate,
  // and drawing them makes the sensitivity property a lottery (measured: 9
  // flips in 100 draws, a reach floor that fails at random):
  //   - the feature scopes its own matching handler, so the scoped pass
  //     answers first whatever loads where - that is the fix working;
  //   - every other matching registration is scoped to some OTHER feature, so
  //     the plant is the only unscoped match and wins in every ordering.
  // The plantable corpus is the rest: an unscoped match elsewhere and no
  // scoped one here, where a planted file loading first flips the answer by
  // construction, on every draw.
  const plantable = ambiguous.filter(({ feature, text, files }) => {
    const matching = files.flatMap((f) => byFile.get(f).entries.filter((e) => e.pattern.test(text)));
    const scopedHere = matching.some((e) => e.featureName === feature);
    const unscopedElsewhere = matching.some((e) => !e.featureName);
    return !scopedHere && unscopedElsewhere;
  });
  const drawPlantable = fc.integer({ min: 0, max: Math.max(0, plantable.length - 1) });

  it('has an ambiguous corpus to draw from at all', () => {
    assertReachFloor({ ambiguous: ambiguous.length }, ['ambiguous'], AMBIGUOUS_FLOOR, 'ambiguous step texts');
  });

  // EXHAUSTIVE over the ambiguous corpus, not sampled. The corpus is the
  // finite, enumerable set of (feature, step text) pairs more than one step
  // file matches, and checking all of it every run is strictly stronger than
  // drawing from it - the BL-968 posture. It is also what this check NEEDS:
  // a sampled version stayed green with a real collision reintroduced,
  // because ~3 affected entries in a corpus of ~1270 are almost never drawn.
  it('resolves every ambiguous step the same way under every ordering that could flip it', () => {
    const flipped = [];
    for (const step of ambiguous) {
      const resolutions = resolutionsUnderEveryOrdering(byFile, step);
      if (resolutions.some((handler) => handler !== resolutions[0])) {
        flipped.push(`"${step.text}" for feature "${step.feature}"`);
      }
    }
    assert.deepEqual(
      flipped,
      [],
      `these resolutions depend on which step file loads first:\n  ${flipped.join('\n  ')}`
    );
    assertReachFloor({ ambiguous: ambiguous.length }, ['ambiguous'], AMBIGUOUS_FLOOR, 'ambiguous steps checked');
  });

  it('reports a flip when a second file is planted registering a drawn step text unscoped', () => {
    const coverage = {};
    fc.assert(
      fc.property(drawPlantable, (index) => {
        const step = plantable[index];
        // The offender is DERIVED from the drawn step, not drawn beside it, so
        // every draw is a collision by construction rather than by luck.
        const planted = {
          file: path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'bl1277PlantedOffenderSteps.js'),
          entries: [{ pattern: new RegExp(`^${escapeForPattern(step.text)}$`), handler: () => {}, featureName: undefined }],
        };
        const resolutions = resolutionsUnderEveryOrdering(byFile, step, planted);
        const flipped = resolutions.some((handler) => handler !== resolutions[0]);
        assert.ok(
          flipped,
          `planting an unscoped duplicate of "${step.text}" did not change the answer for "${step.feature}" - the order-independence check cannot see a collision`
        );
        coverage.flip = (coverage.flip || 0) + 1;
        return true;
      }),
      { numRuns: AMBIGUOUS_FLOOR * 5 }
    );
    assertReachFloor(coverage, ['flip'], SENSITIVITY_FLOOR, 'planted-collision flips');
  });
});

function escapeForPattern(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── invariant 2 ────────────────────────────────────────────────────────────

// Each shape names how the file registers, and whether a scanner looking for
// the literal `registry.define(` in the source would see it. The point of the
// pairing is that for every shape the scanner and the registry disagree.
const REGISTERS_WITHOUT_THE_LITERAL = {
  alias: (pattern) => `const d = registry.define.bind(registry);\n  d(/${pattern}/, () => {});`,
  loop: (pattern) => `for (const p of [/${pattern}/]) {\n    registry['def' + 'ine'](p, () => {});\n  }`,
  helper: (pattern) => `const add = (r, p) => r.define(p, () => {});\n  add(registry, /${pattern}/);`,
  computed: (pattern) => `registry[['de', 'fine'].join('')](new RegExp(${JSON.stringify(pattern)}), () => {});`,
};

const LITERAL_WITHOUT_REGISTERING = {
  comment: (pattern) => `// registry.define(/${pattern}/, () => {});`,
  string: (pattern) => `const dead = "registry.define(/${pattern}/, () => {})";\n  void dead;`,
};

const PATTERN = '^the widget is ready$';
const SHAPE_FLOOR = 3;

function writeStepFile(root, name, body) {
  const file = path.join(root, name);
  fs.writeFileSync(file, `'use strict';\nmodule.exports = { registerSteps(registry) {\n  ${body}\n} };\n`);
  return file;
}

// One fc.assert per shape: the reach floor is then met by construction, not by
// hoping a uniform constantFrom draw covered every shape.
function forEachShape(shapes, coverage, body) {
  for (const shape of Object.keys(shapes)) {
    fc.assert(
      fc.property(fc.constant(shape), (drawn) => {
        coverage[drawn] = (coverage[drawn] || 0) + 1;
        const root = mkSharedTmpDir('bl1277-prop-');
        try {
          body(drawn, root);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
        return true;
      }),
      { numRuns: SHAPE_FLOOR }
    );
  }
}

describe("BL-1277 invariant 2: the verdict comes from the registry, not from the step file's source text", () => {
  it('refuses a duplicate registered without the literal `registry.define(` ever appearing in the source', () => {
    const coverage = {};
    forEachShape(REGISTERS_WITHOUT_THE_LITERAL, coverage, (shape, root) => {
      const plain = writeStepFile(root, 'plainSteps.js', `registry.define(/${PATTERN}/, () => {});`);
      const sneaky = writeStepFile(root, 'sneakySteps.js', REGISTERS_WITHOUT_THE_LITERAL[shape](PATTERN));
      assert.ok(
        !fs.readFileSync(sneaky, 'utf8').includes('registry.define('),
        `${shape}: the fixture is meant to register WITHOUT the literal a scanner looks for`
      );

      const verdict = collisionVerdict([plain, sneaky]);

      assert.equal(verdict.ok, false, `${shape}: a registry-derived guard must still see this collision`);
      assert.equal(verdict.collisions.length, 1);
      assert.deepEqual(verdict.collisions[0].files, [plain, sneaky]);
    });
    assertReachFloor(coverage, Object.keys(REGISTERS_WITHOUT_THE_LITERAL), SHAPE_FLOOR, 'registers-without-the-literal shape');
  });

  it('passes a file whose source is full of `registry.define(` text that registers nothing', () => {
    const coverage = {};
    forEachShape(LITERAL_WITHOUT_REGISTERING, coverage, (shape, root) => {
      const plain = writeStepFile(root, 'plainSteps.js', `registry.define(/${PATTERN}/, () => {});`);
      const decoy = writeStepFile(root, 'decoySteps.js', LITERAL_WITHOUT_REGISTERING[shape](PATTERN));
      assert.ok(
        fs.readFileSync(decoy, 'utf8').includes('registry.define('),
        `${shape}: the fixture is meant to carry the literal a scanner looks for`
      );

      assert.equal(
        collisionVerdict([plain, decoy]).ok,
        true,
        `${shape}: nothing was registered twice, so a registry-derived guard must not refuse`
      );
    });
    assertReachFloor(coverage, Object.keys(LITERAL_WITHOUT_REGISTERING), SHAPE_FLOOR, 'literal-without-registering shape');
  });
});
