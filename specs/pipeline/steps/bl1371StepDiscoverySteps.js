'use strict';

// BL-1371: a step handler registers without a shared file.
//
// Drives the REAL discovery module the acceptance runner loads
// (specs/pipeline/steps/discoverStepHandlers.js, reached from index.js), not a
// restatement of its rule - the whole point of the ticket is that the runner's
// own registration path changed, so a scenario that re-implemented the glob
// would report green for a registry it never touched (BL-1235's shape).
//
// The "new handler file", "exports no steps" and "throws when required"
// scenarios need files that must NOT exist in the project's own steps
// directory (a file that throws would break every other run), so those run
// against a fixture steps directory. Scenario 02 - every handler loaded today
// is still loaded - is asked of the REAL directory, because that is the one
// invariant 1 is about.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  HANDLER_FILE_SUFFIX,
  stepHandlerFileNames,
  loadStepHandlerModules,
  registerDiscoveredSteps,
} = require('./discoverStepHandlers');
const { createStepRegistry } = require('../stepRegistry');

const FEATURE = 'A step handler registers without a shared file';
const STEPS_DIR = __dirname;
const FIXTURE_PREFIX = 'aps-bl1371-steps-';

// BL-971: a killed run traps no finally, so every fixture root this handler
// ever made is swept by prefix BEFORE the first one of this run is created,
// as well as removed in the finally of the scenario that made it.
function sweepStaleFixtureRoots() {
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    }
  }
}

function fixtureDir(ctx) {
  if (!ctx.bl1371Dir) {
    sweepStaleFixtureRoots();
    ctx.bl1371Dir = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
    ctx.bl1371Planted = [];
  }
  return ctx.bl1371Dir;
}

function plant(ctx, name, source) {
  const dir = fixtureDir(ctx);
  fs.writeFileSync(path.join(dir, name), source);
  ctx.bl1371Planted.push(name);
  return name;
}

function cleanup(ctx) {
  if (ctx.bl1371Dir) {
    fs.rmSync(ctx.bl1371Dir, { recursive: true, force: true });
    ctx.bl1371Dir = null;
  }
}

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function registerSteps(registry) {
  scoped(registry, /^the acceptance runner loads this project's step handlers$/, (ctx) => {
    ctx.bl1371StepsDir = STEPS_DIR;
  });

  scoped(registry, /^a new step handler file is added to the steps directory$/, (ctx) => {
    ctx.bl1371Before = fs.readdirSync(fixtureDir(ctx)).sort();
    ctx.bl1371New = plant(
      ctx,
      `bl1371FixtureNewlyAddedSteps.js`,
      [
        "'use strict';",
        'function registerSteps(registry) {',
        "  registry.define(/^a step only the newly added handler knows$/, () => {});",
        '}',
        'module.exports = { registerSteps };',
        '',
      ].join('\n')
    );
    ctx.bl1371StepsDir = ctx.bl1371Dir;
  });

  scoped(registry, /^a file in the steps directory that exports no steps$/, (ctx) => {
    ctx.bl1371Inert = plant(
      ctx,
      'bl1371FixtureNoExportedSteps.js',
      ["'use strict';", 'module.exports = { somethingElse: true };', ''].join('\n')
    );
    ctx.bl1371StepsDir = ctx.bl1371Dir;
  });

  scoped(registry, /^a step handler file that throws when required$/, (ctx) => {
    ctx.bl1371Throwing = plant(
      ctx,
      'bl1371FixtureThrowsOnRequireSteps.js',
      ["'use strict';", "throw new Error('BL-1371 fixture: this handler cannot be loaded');", ''].join('\n')
    );
    plant(
      ctx,
      'bl1371FixtureHealthyNeighbourSteps.js',
      [
        "'use strict';",
        'function registerSteps(registry) {',
        "  registry.define(/^a step the healthy neighbour registers$/, () => {});",
        '}',
        'module.exports = { registerSteps };',
        '',
      ].join('\n')
    );
    ctx.bl1371StepsDir = ctx.bl1371Dir;
  });

  scoped(registry, /^the runner loads the handlers$/, (ctx) => {
    const dir = ctx.bl1371StepsDir || STEPS_DIR;
    ctx.bl1371Registry = createStepRegistry();
    ctx.bl1371Error = null;
    try {
      registerDiscoveredSteps(ctx.bl1371Registry, dir);
      ctx.bl1371Loaded = loadStepHandlerModules(dir).map((entry) => entry.name);
    } catch (err) {
      ctx.bl1371Error = err;
      ctx.bl1371Loaded = [];
    }
  });

  scoped(registry, /^that handler's steps are available$/, (ctx) => {
    assert.equal(ctx.bl1371Error, null, `loading the handlers failed: ${ctx.bl1371Error?.message}`);
    assert.ok(
      ctx.bl1371Loaded.includes(ctx.bl1371New),
      `discovery did not load the newly added handler ${ctx.bl1371New}: ${ctx.bl1371Loaded.join(', ')}`
    );
    assert.ok(
      ctx.bl1371Registry.resolve('a step only the newly added handler knows'),
      'the newly added handler registered no resolvable step'
    );
  });

  scoped(registry, /^no file another ticket also edits was changed to achieve it$/, (ctx) => {
    const after = fs.readdirSync(ctx.bl1371Dir).sort();
    const added = after.filter((name) => !ctx.bl1371Before.includes(name));
    assert.deepEqual(added, [ctx.bl1371New], `adding a handler changed more than its own file: ${added.join(', ')}`);
    const removedOrKept = after.filter((name) => ctx.bl1371Before.includes(name));
    assert.deepEqual(removedOrKept, ctx.bl1371Before, 'an existing file was changed or removed');
    cleanup(ctx);
  });

  scoped(registry, /^every handler the registry loads today is present$/, (ctx) => {
    assert.equal(ctx.bl1371Error, null, `loading the project's handlers failed: ${ctx.bl1371Error?.message}`);
    // Compared as SETS of handler identities, never as counts (invariant 1):
    // two changes that cancel out is exactly the failure a count survives.
    const onDisk = fs
      .readdirSync(STEPS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(HANDLER_FILE_SUFFIX))
      .map((entry) => entry.name);
    const discovered = new Set(stepHandlerFileNames(STEPS_DIR));
    const missing = onDisk.filter((name) => !discovered.has(name));
    assert.deepEqual(missing, [], `handler files present but not discovered: ${missing.join(', ')}`);
    const loaded = new Set(ctx.bl1371Loaded);
    const notLoaded = [...discovered].filter((name) => !loaded.has(name));
    assert.deepEqual(notLoaded, [], `handlers discovered but not loaded: ${notLoaded.join(', ')}`);
    assert.ok(discovered.size > 900, `expected the project's whole handler set, got ${discovered.size}`);
  });

  scoped(registry, /^that file contributes no steps$/, (ctx) => {
    assert.equal(ctx.bl1371Error, null, `a file exporting no steps must not fail the run: ${ctx.bl1371Error?.message}`);
    assert.ok(
      !ctx.bl1371Loaded.includes(ctx.bl1371Inert),
      `a file exporting no steps was loaded as a handler: ${ctx.bl1371Inert}`
    );
    assert.deepEqual(ctx.bl1371Registry.listDefinitions(), [], 'a file exporting no steps contributed a definition');
    cleanup(ctx);
  });

  scoped(registry, /^the run fails naming that file$/, (ctx) => {
    assert.ok(ctx.bl1371Error, 'a handler that throws when required did not fail the run');
    assert.ok(
      ctx.bl1371Error.message.includes(ctx.bl1371Throwing),
      `the failure does not name the offending file:\n${ctx.bl1371Error.message}`
    );
  });

  scoped(registry, /^no scenario is reported as passing$/, (ctx) => {
    // Discovery loads every handler BEFORE registering any of them, so a
    // single unloadable file leaves an empty registry - the runner then has
    // no handler to match any scenario's steps with, rather than a partial
    // registry that runs some scenarios green.
    assert.deepEqual(
      ctx.bl1371Registry.listDefinitions(),
      [],
      'a failed load still registered steps, so scenarios could report passing'
    );
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
