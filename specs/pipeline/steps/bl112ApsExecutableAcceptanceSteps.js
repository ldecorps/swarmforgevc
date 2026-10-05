'use strict';

// BL-1944 (BL-112 stamp-off): step handlers for "feature files run as
// generated acceptance tests against the host core". Drives the REAL
// specs/pipeline/runnerAdapter.js (parseFeatureFile/writeEntryPoints/
// runGeneratedTests via runPipeline) end to end against fixture feature
// files and step modules written under a tracked mkdtemp root - never a
// restatement of generation or running.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { trackedTmpRoot } = require('./lib/fixtureReaper');
const { runPipeline, runGeneratedTests } = require('../runnerAdapter');

const FEATURE = 'feature files run as generated acceptance tests against the host core';

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// A step module every scenario here shares: "Given nothing" / "When
// nothing happens" always pass; "Then it passes" passes, "Then it fails"
// throws - so scenario 02 can drive a Then-condition the core does not
// satisfy without a second fixture module.
function writeStepsModule(dir) {
  const stepsPath = path.join(dir, 'steps.js');
  fs.writeFileSync(
    stepsPath,
    [
      "'use strict';",
      'function registerSteps(registry) {',
      "  registry.define(/^nothing$/, () => {});",
      "  registry.define(/^nothing happens$/, () => {});",
      "  registry.define(/^it passes$/, () => {});",
      "  registry.define(/^it fails$/, () => { throw new Error('the core does not satisfy this condition'); });",
      '}',
      'module.exports = { registerSteps };',
      '',
    ].join('\n')
  );
  return stepsPath;
}

function writeFeatureFile(dir, name, thenText) {
  const featurePath = path.join(dir, 'fixture.feature');
  fs.writeFileSync(
    featurePath,
    `Feature: ${name}\n  Scenario: the fixture scenario\n    Given nothing\n    When nothing happens\n    Then ${thenText}\n`
  );
  return featurePath;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^a parsed feature file in specs\/features\/$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl112-pipeline-');
    ctx.bl112 = {
      root,
      featurePath: writeFeatureFile(root, 'BL-112 fixture - passes', 'it passes'),
      stepsPath: writeStepsModule(root),
      outDir: path.join(root, 'generated'),
    };
  });

  scoped(/^acceptance generation runs$/, async (ctx) => {
    ctx.bl112.result = await runPipeline(ctx.bl112.featurePath, ctx.bl112.outDir, ctx.bl112.stepsPath);
  });

  scoped(/^generated entry points exist for its scenarios$/, (ctx) => {
    const files = fs.readdirSync(ctx.bl112.outDir).filter((f) => f.endsWith('.generated.test.js'));
    assert.ok(files.length > 0, `expected at least one generated entry point under ${ctx.bl112.outDir}, found: ${files.join(', ')}`);
    ctx.bl112.generatedFile = path.join(ctx.bl112.outDir, files[0]);
  });

  scoped(/^running them exercises the host-side core without booting VS Code$/, (ctx) => {
    // The scenario's own step handlers (writeStepsModule above) never
    // reference the VS Code API - the fixture module touches nothing
    // but plain functions - and the pipeline's own run already executed
    // it via runGeneratedTests (node --test), not a VS Code host.
    assert.equal(ctx.bl112.result.success, true, `expected the generated test to pass, got output:\n${ctx.bl112.result.output}`);
    const generatedSource = fs.readFileSync(ctx.bl112.generatedFile, 'utf8');
    assert.doesNotMatch(generatedSource, /vscode/i, 'a generated entry point must reference no VS Code API');
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^a scenario whose Then-condition the core does not satisfy$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl112-pipeline-');
    ctx.bl112 = {
      root,
      featurePath: writeFeatureFile(root, 'BL-112 fixture - fails', 'it fails'),
      stepsPath: writeStepsModule(root),
      outDir: path.join(root, 'generated'),
    };
  });

  scoped(/^its generated acceptance test runs$/, async (ctx) => {
    ctx.bl112.result = await runPipeline(ctx.bl112.featurePath, ctx.bl112.outDir, ctx.bl112.stepsPath);
  });

  scoped(/^the run fails and names the failing scenario$/, (ctx) => {
    assert.equal(ctx.bl112.result.success, false, 'expected the pipeline to report failure');
    assert.match(
      ctx.bl112.result.output,
      /the fixture scenario/,
      `expected the failure output to name the scenario, got:\n${ctx.bl112.result.output}`
    );
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the acceptance pipeline executes end to end$/, async (ctx) => {
    const calls = [];
    const root = trackedTmpRoot('sfvc-bl112-sequencing-');
    const sentinelPath = path.join(root, 'generated-sentinel.txt');
    const deps = {
      parse: async () => {
        calls.push('parse');
        return { name: 'BL-112 sequencing fixture', scenarios: [] };
      },
      generate: async (feature) => {
        calls.push('generate-start');
        // A deliberately non-instant write, so a runner that started
        // before generation truly finished would read a partial file.
        await new Promise((resolve) => setTimeout(resolve, 20));
        fs.writeFileSync(sentinelPath, JSON.stringify(feature));
        calls.push('generate-end');
        return sentinelPath;
      },
      run: (filePaths) => {
        calls.push('run-start');
        // Proof generation had fully completed: the file is readable
        // AND holds the exact content generate wrote, not a partial
        // write a concurrent run could have raced.
        const content = fs.readFileSync(filePaths[0], 'utf8');
        assert.deepEqual(JSON.parse(content), { name: 'BL-112 sequencing fixture', scenarios: [] });
        calls.push('run-end');
        return { success: true, output: '' };
      },
    };
    await runPipeline('unused.feature', root, 'unused-steps.js', deps);
    ctx.bl112 = { calls };
  });

  scoped(/^generation completes before any acceptance run starts$/, (ctx) => {
    assert.deepEqual(
      ctx.bl112.calls,
      ['parse', 'generate-start', 'generate-end', 'run-start', 'run-end'],
      `expected generation to fully finish before the run started, got: ${ctx.bl112.calls.join(', ')}`
    );
  });

  scoped(/^no whole-suite unit run executes concurrently with either$/, () => {
    // runGeneratedTests spawns the acceptance run via spawnSync - a
    // synchronous child-process wait, never a Promise - so the calling
    // process (and anything it might otherwise have run, such as the
    // extension's whole-suite Vitest run) is blocked for the run's
    // entire duration and cannot overlap it. Checked on the function's
    // own declaration (never invoked with no files - spawnSync('node',
    // ['--test']) with nothing to filter on would run Node's default
    // discovery over the whole cwd, an unrelated and unbounded process
    // this check has no reason to start).
    assert.notEqual(runGeneratedTests.constructor.name, 'AsyncFunction', 'runGeneratedTests must not be declared async');
    assert.equal(
      require('node:util').types.isAsyncFunction(runGeneratedTests),
      false,
      'runGeneratedTests must be synchronous (spawnSync), never return a Promise a caller could race against'
    );
  });
}

module.exports = { registerSteps };
