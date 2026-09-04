'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1371: specs/pipeline/steps/index.js registers a step handler by
// DISCOVERING its file rather than by naming it in a hand-maintained array.
//
// The real registry is exercised over FIXTURE steps directories, never over
// this repository's own: requiring the live index.js loads ~940 handler
// modules (several of which import node:test, which derails Vitest's own
// collection - see helpers/stepCollisionGuard.js). A COPY of the real module
// placed in a fixture directory loads only that directory's handlers, because
// its eager load defaults to its own __dirname - so these tests drive the real
// implementation at real cost.

const REAL_REGISTRY = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'index.js');
const REAL_STEP_REGISTRY = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'stepRegistry.js');
const { createStepRegistry } = require(REAL_STEP_REGISTRY);

let fixtureSeq = 0;

/**
 * A steps directory holding a copy of the real registry module plus `files`
 * (name -> source, `/`-separated names land in subdirectories). Returns the
 * REQUIRED copy, so every assertion is about the real implementation.
 *
 * `load: false` returns the paths without requiring, for the cases that are
 * about what the eager module-load itself does.
 */
function fixture(files, { load = true } = {}) {
  const root = mkTmpDir('bl1371-unit-');
  // A fresh directory name per fixture keeps require's cache from answering
  // for a previous fixture's copy of the module.
  const stepsDir = path.join(root, `steps${(fixtureSeq += 1)}`);
  fs.mkdirSync(stepsDir, { recursive: true });
  const registryPath = path.join(stepsDir, 'index.js');
  fs.copyFileSync(REAL_REGISTRY, registryPath);
  for (const [name, source] of Object.entries(files)) {
    const full = path.join(stepsDir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source, 'utf8');
  }
  return { stepsDir, registryPath, registry: load ? require(registryPath) : undefined };
}

function handler(...patterns) {
  return [
    "'use strict';",
    'function registerSteps(registry) {',
    ...patterns.map((p) => `  registry.define(/^${p}$/, () => ${JSON.stringify(p)});`),
    '}',
    'module.exports = { registerSteps };',
    '',
  ].join('\n');
}

function names(files) {
  return files.map((f) => path.basename(f));
}

function patternsOf(registryModule) {
  const registry = createStepRegistry();
  registryModule.registerSteps(registry);
  return registry
    .listDefinitions()
    .map((d) => d.pattern.source)
    .sort();
}

// ── discovery: which files register ────────────────────────────────────────

test('a top-level *Steps.js file is registered by existing, with no entry anywhere', () => {
  const { registry, registryPath } = fixture({
    'aSteps.js': handler('a step'),
    'bSteps.js': handler('b step'),
  });
  assert.deepEqual(names(registry.discoverHandlerFiles()), ['aSteps.js', 'bSteps.js']);
  assert.deepEqual(patternsOf(registry), ['^a step$', '^b step$']);
  // The registry file is byte-identical to the shipped one: registering those
  // two handlers took no edit to any shared file.
  assert.deepEqual(fs.readFileSync(registryPath), fs.readFileSync(REAL_REGISTRY));
});

test('a .js file whose name does not end in the handler suffix is not registered', () => {
  const { registry } = fixture({
    'aSteps.js': handler('a step'),
    // The `*Only.js` focused entry points have this shape: each re-exports
    // another file's registerSteps, and loading both would register every one
    // of that file's patterns twice.
    'aOnly.js': "'use strict';\nmodule.exports = require('./aSteps');\n",
    'notes.js': handler('a decoy step'),
  });
  assert.deepEqual(names(registry.discoverHandlerFiles()), ['aSteps.js']);
  assert.deepEqual(patternsOf(registry), ['^a step$']);
});

test('discovery is not recursive, so steps/lib/ helpers are never handlers', () => {
  const { registry } = fixture({
    'aSteps.js': handler('a step'),
    // lib/androidJvmDecisionSteps.js really has this shape: it ends in the
    // handler suffix and is required BY a handler rather than being one.
    'lib/androidJvmDecisionSteps.js': handler('a lib step'),
  });
  assert.deepEqual(names(registry.discoverHandlerFiles()), ['aSteps.js']);
  assert.deepEqual(patternsOf(registry), ['^a step$']);
});

test('discovery order is sorted by file name, so it is deterministic', () => {
  const { registry } = fixture({
    'zSteps.js': handler('z step'),
    'aSteps.js': handler('a step'),
    'mSteps.js': handler('m step'),
  });
  assert.deepEqual(names(registry.discoverHandlerFiles()), ['aSteps.js', 'mSteps.js', 'zSteps.js']);
});

test('an empty steps directory discovers nothing rather than throwing', () => {
  const { registry } = fixture({});
  assert.deepEqual(registry.discoverHandlerFiles(), []);
  assert.deepEqual(patternsOf(registry), []);
});

// ── a discovered file that is not a handler ────────────────────────────────

test('a discovered file that exports no registerSteps contributes no steps and does not fail', () => {
  const { registry } = fixture({
    'aSteps.js': handler('a step'),
    'silentSteps.js': "'use strict';\nmodule.exports = { NOT_A_HANDLER: true };\n",
    'emptySteps.js': "'use strict';\n",
  });
  // It IS discovered - it is skipped at registration, not filtered by name.
  assert.deepEqual(names(registry.discoverHandlerFiles()), [
    'aSteps.js',
    'emptySteps.js',
    'silentSteps.js',
  ]);
  assert.deepEqual(patternsOf(registry), ['^a step$']);
});

// ── invariant 2: a file that cannot be required fails loudly, by name ──────

test('a handler that throws when required fails the module load, naming the file', () => {
  const { registryPath } = fixture(
    {
      'aSteps.js': handler('a step'),
      'brokenSteps.js': "'use strict';\nthrow new Error('fixture: cannot be required');\n",
    },
    { load: false }
  );
  assert.throws(
    () => require(registryPath),
    (err) => {
      assert.match(err.message, /brokenSteps\.js/);
      assert.match(err.message, /could not be loaded/);
      // The cause survives, both as `cause` and appended to the stack: the
      // module that actually failed may be a lib module several requires
      // deep, and the guard reading this failure needs both names.
      assert.match(err.stack, /fixture: cannot be required/);
      assert.equal(err.cause.message, 'fixture: cannot be required');
      return true;
    }
  );
});

test('a handler requiring a module the tree does not carry fails, naming the handler', () => {
  const { registryPath } = fixture(
    { 'ghostSteps.js': "'use strict';\nrequire('./nowhere');\n" },
    { load: false }
  );
  assert.throws(() => require(registryPath), /ghostSteps\.js/);
});

test('a handler with a syntax error fails the module load, naming the file', () => {
  const { registryPath } = fixture(
    { 'brokeSteps.js': "'use strict';\nfunction registerSteps( {\n" },
    { load: false }
  );
  assert.throws(() => require(registryPath), /brokeSteps\.js/);
});

test('the load is EAGER, so a tree that cannot load fails at require, not at first use', () => {
  // BL-968's guard decides loadability by REQUIRING the registry, and
  // BL-968 invariant 1 is a statement about what a step file may do AT MODULE
  // LOAD. A lazily-loading registry would leave both passing on a tree that
  // cannot load.
  const { registryPath } = fixture(
    { 'brokenSteps.js': "'use strict';\nthrow new Error('fixture: cannot be required');\n" },
    { load: false }
  );
  let required = false;
  try {
    require(registryPath);
    required = true;
  } catch {
    // expected
  }
  assert.equal(required, false, 'requiring the registry did not load the handlers');
});

// ── the suffix is one literal, mirrored across a language boundary ─────────

test('the registry and the registration guard agree on the handler suffix literal', () => {
  // BL-897: a constant mirrored across a language boundary needs a test
  // asserting both literals agree. featureHandlerRegistrationTypes.ts decides
  // which handlers the commit guard treats as discovered; index.js decides
  // which ones actually load. They must be the same predicate.
  const { HANDLER_SUFFIX } = require('../out/tools/featureHandlerRegistrationTypes');
  const { registry } = fixture({});
  assert.equal(registry.HANDLER_SUFFIX, HANDLER_SUFFIX);
  assert.equal(HANDLER_SUFFIX, 'Steps.js');
});
