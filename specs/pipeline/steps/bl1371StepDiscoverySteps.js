'use strict';

// BL-1371: a step handler registers without a shared file.
//
// Every scenario drives the REAL registry module
// (specs/pipeline/steps/index.js) over a REAL steps directory on disk. The
// directory is a temp fixture rather than this repository's own, for two
// reasons: scenario 04 needs a handler file that THROWS when required, which
// cannot be planted in the live tree without breaking every other lane that
// loads it; and scenario 01's whole point is that adding a file is the entire
// registration, which is only demonstrable if the file really is added to a
// directory discovery then reads.
//
// index.js takes the steps directory as a parameter for exactly this reason,
// so nothing here restates the discovery predicate - the assertions ask the
// real module what it found.
//
// BL-968 invariant 1: nothing at module load here runs a subprocess, resolves
// a git root, or reads live repository state. The constants below are pure
// path joins; every fixture is built inside a step function.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PIPELINE_DIR = path.join(__dirname, '..');
const REGISTRY_PATH = path.join(__dirname, 'index.js');
const STEP_REGISTRY_PATH = path.join(PIPELINE_DIR, 'stepRegistry.js');
const RUN_ACCEPTANCE = path.join(PIPELINE_DIR, 'scripts', 'run_acceptance.sh');
const RUN_GHERKIN_MUTATION = path.join(PIPELINE_DIR, 'scripts', 'run_gherkin_mutation.sh');
const FEATURES_DIR = path.join(PIPELINE_DIR, '..', 'features');

const FEATURE = 'A step handler registers without a shared file';

// BL-971: a killed run traps nothing, so the prefix is swept BEFORE the run
// as well as removed in a finally.
const FIXTURE_PREFIX = 'bl1371-steps-';

function sweepStaleFixtures() {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    }
  }
}

function handlerSource(pattern, marker) {
  return [
    "'use strict';",
    'function registerSteps(registry) {',
    `  registry.define(${pattern}, () => ${JSON.stringify(marker)});`,
    '}',
    'module.exports = { registerSteps };',
    '',
  ].join('\n');
}

/**
 * A steps directory containing only what a scenario planted, plus a copy of
 * the real registry module so both runners resolve to a discovery registry
 * over THIS directory. `files` maps a bare file name to its source.
 */
function buildStepsDir(files) {
  sweepStaleFixtures();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  const stepsDir = path.join(root, 'specs', 'pipeline', 'steps');
  fs.mkdirSync(stepsDir, { recursive: true });
  fs.copyFileSync(REGISTRY_PATH, path.join(stepsDir, 'index.js'));
  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(stepsDir, name), source, 'utf8');
  }
  return { root, stepsDir, pipelineDir: path.dirname(stepsDir) };
}

// Discovery + registration run in a CHILD process for the same reason
// BL-968's guard and BL-1277's collision guard do: the fixture's index.js is a
// copy, and a scenario that plants a throwing module must not be able to
// derail the lane it runs in. One JSON line out, so a failure is a verdict
// rather than a crash.
const PROBE = [
  "'use strict';",
  'const registryPath = process.argv[2];',
  'const stepsDir = process.argv[3];',
  'const stepRegistryPath = process.argv[4];',
  'const out = { ok: false };',
  'try {',
  '  const mod = require(registryPath);',
  '  out.discovered = mod.discoverHandlerFiles(stepsDir).map((f) => require("node:path").basename(f));',
  '  const handlers = mod.loadHandlers(stepsDir);',
  '  const { createStepRegistry } = require(stepRegistryPath);',
  '  const registry = createStepRegistry();',
  '  mod.registerLoadedHandlers(registry, handlers);',
  '  out.patterns = registry.listDefinitions().map((d) => d.pattern.source);',
  '  out.ok = true;',
  '} catch (err) {',
  '  out.error = err.message || String(err);',
  '  out.stack = err.stack || "";',
  '}',
  'process.stdout.write(`BL1371_PROBE ${JSON.stringify(out)}\\n`);',
  '',
].join('\n');

function probe(fixture, registryPath = path.join(fixture.stepsDir, 'index.js')) {
  const probePath = path.join(fixture.root, 'bl1371-probe.js');
  fs.writeFileSync(probePath, PROBE, 'utf8');
  const res = execFileSync(
    process.execPath,
    [probePath, registryPath, fixture.stepsDir, STEP_REGISTRY_PATH],
    { encoding: 'utf8' }
  );
  const line = res.split('\n').find((l) => l.startsWith('BL1371_PROBE '));
  assert.ok(line, `the discovery probe produced no verdict: ${res}`);
  return JSON.parse(line.slice('BL1371_PROBE '.length));
}

/**
 * The steps-module path a runner script DEFAULTS to, read out of that
 * script's own text and evaluated by bash against a given PIPELINE_DIR -
 * never restated here. A runner that stopped defaulting on one line, or that
 * started defaulting somewhere else, fails this rather than passing quietly.
 */
function runnerDefaultStepsModule(scriptPath, pipelineDir) {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const match = src.match(/^STEPS_MODULE="\$\{3:-(.+)\}"$/m);
  assert.ok(
    match,
    `${path.basename(scriptPath)} no longer defaults STEPS_MODULE on a single line - this scenario can no longer read what it resolves`
  );
  return execFileSync(
    'bash',
    ['-c', `PIPELINE_DIR=${JSON.stringify(pipelineDir)}; printf '%s' "${match[1]}"`],
    { encoding: 'utf8' }
  );
}

function state(ctx) {
  if (!ctx.bl1371) {
    ctx.bl1371 = { plant: {}, cleanup: [] };
  }
  return ctx.bl1371;
}

function withFixture(s, fn) {
  const fixture = buildStepsDir(s.plant);
  try {
    return fn(fixture);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

/** Every top-level *Steps.js file in the live steps directory, enumerated here
 * rather than asked of discovery - so scenario 02 compares two independent
 * answers instead of comparing discovery with itself. */
function liveHandlerNames() {
  return fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('Steps.js'))
    .map((entry) => entry.name)
    .sort();
}

const NEW_HANDLER = 'bl1371NewlyAddedSteps.js';
const NEW_HANDLER_PATTERN = '/^bl1371 a newly added handler answers$/';
const SILENT_FILE = 'bl1371ExportsNothingSteps.js';
const THROWING_HANDLER = 'bl1371ThrowsOnRequireSteps.js';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────

  scoped(/^the acceptance runner loads this project's step handlers$/, (ctx) => {
    const s = state(ctx);
    const mod = require(REGISTRY_PATH);
    for (const name of ['registerSteps', 'registerLoadedHandlers', 'discoverHandlerFiles', 'loadHandlers']) {
      assert.equal(typeof mod[name], 'function', `steps/index.js must export ${name}()`);
    }
    s.ready = true;
  });

  // ── Given ───────────────────────────────────────────────────────────────

  scoped(/^a new step handler file is added to the steps directory$/, (ctx) => {
    const s = state(ctx);
    // Two files: one standing in for a handler that was already there, one
    // brand new. A discovery that returned only the new file, or only the old
    // one, fails the Then steps below.
    s.plant['bl1371AlreadyPresentSteps.js'] = handlerSource(
      '/^bl1371 a handler that was already here answers$/',
      'already-present'
    );
    s.plant[NEW_HANDLER] = handlerSource(NEW_HANDLER_PATTERN, 'newly-added');
    s.newHandler = NEW_HANDLER;
  });

  scoped(/^a file in the steps directory that exports no steps$/, (ctx) => {
    const s = state(ctx);
    s.plant['bl1371AlreadyPresentSteps.js'] = handlerSource(
      '/^bl1371 a handler that was already here answers$/',
      'already-present'
    );
    // Named so discovery DOES pick it up - a file discovery skips by name
    // would make this scenario vacuous. It loads fine and simply exports no
    // registerSteps.
    s.plant[SILENT_FILE] = "'use strict';\nmodule.exports = { NOT_A_HANDLER: true };\n";
    s.silentFile = SILENT_FILE;
  });

  scoped(/^a step handler file that throws when required$/, (ctx) => {
    const s = state(ctx);
    s.plant['bl1371AlreadyPresentSteps.js'] = handlerSource(
      '/^bl1371 a handler that was already here answers$/',
      'already-present'
    );
    s.plant[THROWING_HANDLER] = [
      "'use strict';",
      "throw new Error('bl1371 fixture: this handler cannot be required');",
      '',
    ].join('\n');
    s.throwingFile = THROWING_HANDLER;
  });

  // ── When ────────────────────────────────────────────────────────────────

  scoped(/^the runner loads the handlers$/, (ctx) => {
    const s = state(ctx);
    if (Object.keys(s.plant).length === 0) {
      // Scenario 02 asks about the LIVE registry, not a fixture.
      s.live = {
        discovered: require(REGISTRY_PATH)
          .discoverHandlerFiles()
          .map((file) => path.basename(file))
          .sort(),
        enumerated: liveHandlerNames(),
      };
      return;
    }
    s.result = withFixture(s, (fixture) => probe(fixture));
  });

  scoped(/^each runner resolves its handlers$/, (ctx) => {
    const s = state(ctx);
    s.result = withFixture(s, (fixture) => {
      const acceptance = runnerDefaultStepsModule(RUN_ACCEPTANCE, fixture.pipelineDir);
      const mutation = runnerDefaultStepsModule(RUN_GHERKIN_MUTATION, fixture.pipelineDir);
      return {
        acceptanceModule: acceptance,
        mutationModule: mutation,
        acceptance: probe(fixture, acceptance),
        mutation: probe(fixture, mutation),
      };
    });
  });

  // ── Then ────────────────────────────────────────────────────────────────

  scoped(/^that handler's steps are available$/, (ctx) => {
    const s = state(ctx);
    assert.equal(s.result.ok, true, `loading the handlers failed: ${s.result.error}`);
    assert.deepEqual(
      [...s.result.discovered].sort(),
      ['bl1371AlreadyPresentSteps.js', s.newHandler].sort(),
      'discovery did not load exactly the planted handler files'
    );
    assert.ok(
      s.result.patterns.includes(NEW_HANDLER_PATTERN.slice(1, -1)),
      `the new handler's step pattern is not in the registry: ${JSON.stringify(s.result.patterns)}`
    );
  });

  scoped(/^no file another ticket also edits was changed to achieve it$/, (ctx) => {
    const s = state(ctx);
    // The fixture wrote ONLY the handler files. The one file every ticket used
    // to edit is the registry module itself, so the assertion is that the copy
    // discovery read is byte-identical to this repository's - registration
    // took no edit to it at all.
    withFixture(s, (fixture) => {
      assert.deepEqual(
        fs.readFileSync(path.join(fixture.stepsDir, 'index.js')),
        fs.readFileSync(REGISTRY_PATH),
        'the registry module was edited to register the new handler'
      );
      const planted = fs.readdirSync(fixture.stepsDir).sort();
      assert.deepEqual(
        planted,
        ['bl1371AlreadyPresentSteps.js', 'index.js', s.newHandler].sort(),
        'the fixture directory holds something other than the registry and the planted handlers'
      );
    });
    // The registry never mentions the handler it loaded, which is the whole
    // claim: the file discovery read is byte-identical to the one in this
    // repository, and the name of the handler it registered appears nowhere in
    // it. And the live registry carries no per-handler require lines at all -
    // read with comments stripped, because this file's own header QUOTES the
    // retired `require('./blNNNSteps')` shape to explain what it replaced, and
    // a raw grep would match the explanation.
    const registrySource = fs.readFileSync(REGISTRY_PATH, 'utf8');
    assert.ok(
      !registrySource.includes(path.basename(s.newHandler, '.js')),
      'steps/index.js mentions the handler by name, so registering it was an edit to a shared file'
    );
    const code = registrySource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.deepEqual(
      code.match(/require\('\.\/[A-Za-z0-9_-]*Steps'\)/g) || [],
      [],
      'steps/index.js still names handlers one by one, so registering one still edits a shared file'
    );
  });

  scoped(/^every handler the registry loads today is present$/, (ctx) => {
    const { live } = state(ctx);
    assert.ok(live, 'the live registry was never loaded');
    // Compared as a SET of handler identities, never as a count: two changes
    // that cancel out is exactly the failure a count survives (invariant 1).
    assert.deepEqual(
      live.discovered,
      live.enumerated,
      'discovery and an independent enumeration of the steps directory disagree'
    );
    assert.ok(
      live.discovered.length >= 900,
      `only ${live.discovered.length} handlers were loaded - the registry carries far more than that, so discovery dropped nearly all of them`
    );
    // Every live feature file's OWN ticket-named handler is loaded. This is
    // the half a directory-listing comparison cannot see: it anchors the
    // loaded set on what the suite actually needs.
    const missing = [];
    for (const feature of fs.readdirSync(FEATURES_DIR).filter((n) => n.endsWith('.feature'))) {
      const ticket = feature.match(/^BL-(\d+)/);
      if (!ticket) {
        continue;
      }
      const own = live.enumerated.filter((h) => new RegExp(`^bl${ticket[1]}(?![0-9])`, 'i').test(h));
      if (own.length > 0 && !own.some((h) => live.discovered.includes(h))) {
        missing.push(feature);
      }
    }
    assert.deepEqual(missing, [], 'a live feature file has a handler on disk that discovery does not load');
  });

  scoped(/^that file contributes no steps$/, (ctx) => {
    const s = state(ctx);
    assert.equal(s.result.ok, true, `a file that exports no steps failed the run: ${s.result.error}`);
    assert.ok(
      s.result.discovered.includes(s.silentFile),
      'the file was skipped by NAME, so this scenario proved nothing about a file that exports no steps'
    );
    assert.deepEqual(
      s.result.patterns,
      ['^bl1371 a handler that was already here answers$'],
      'the file that exports no steps contributed a registration'
    );
  });

  scoped(/^the run fails naming that file$/, (ctx) => {
    const s = state(ctx);
    assert.equal(s.result.ok, false, 'a handler that cannot be required loaded clean');
    assert.ok(
      s.result.error.includes(s.throwingFile),
      `the failure did not name the file: ${s.result.error}`
    );
    assert.ok(
      s.result.stack.includes('bl1371 fixture: this handler cannot be required'),
      `the failure lost the underlying reason: ${s.result.stack}`
    );
  });

  scoped(/^no scenario is reported as passing$/, (ctx) => {
    const s = state(ctx);
    // Loading threw, so no registry was ever built and nothing could resolve,
    // let alone run - the run stops rather than reporting a partial pass.
    assert.equal(s.result.ok, false);
    assert.equal(s.result.patterns, undefined, 'a partial registry survived a failed load');
  });

  scoped(
    /^the acceptance runner and the Gherkin mutation runner load the same handler set$/,
    (ctx) => {
      const s = state(ctx);
      const { acceptance, mutation, acceptanceModule, mutationModule } = s.result;
      assert.equal(acceptance.ok, true, `the acceptance runner's module failed to load: ${acceptance.error}`);
      assert.equal(mutation.ok, true, `the mutation runner's module failed to load: ${mutation.error}`);
      assert.deepEqual(
        [...acceptance.discovered].sort(),
        [...mutation.discovered].sort(),
        `the two runners resolve different handler sets (${acceptanceModule} vs ${mutationModule})`
      );
      // Non-vacuous: the set both runners resolved must contain the handler
      // this scenario ADDED. Two runners that both loaded nothing, or both
      // loaded a stale hand-maintained list, would agree while being wrong.
      assert.ok(
        acceptance.discovered.includes(NEW_HANDLER),
        `the acceptance runner did not pick up the newly added handler: ${JSON.stringify(acceptance.discovered)}`
      );
      assert.ok(
        mutation.discovered.includes(NEW_HANDLER),
        `the Gherkin mutation runner did not pick up the newly added handler: ${JSON.stringify(mutation.discovered)}`
      );
    }
  );
}

module.exports = { registerSteps };
