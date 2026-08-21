'use strict';

// BL-984: a property-lane fixture stranded by a SIGKILLed run is executed
// by every later full-lane run as a false red. These steps drive the REAL
// helper entry points against the REAL fixture directory - the sweep under
// test is the same self-healing mechanism that cleans up anything a killed
// acceptance run leaves behind here: every planted strand carries a helper
// prefix plus a pid that is (or soon becomes) dead, so the next sweep
// claims it. The one unprefixed plant uses a fixed name with passing
// content, re-claimed at the start of every run.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  runAsPropertyLaneFixture,
  runManyAsPropertyLaneFixtures,
  sweepStaleFixtures,
} = require('../../../extension/test/helpers/propertyLaneFixtureRunner');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'extension', 'test');
const PROPERTIES_CONFIG_PATH = path.join(REPO_ROOT, 'extension', 'vitest.properties.config.mjs');

// Scenario Outline handlers validate against explicit known values - no
// passthrough (engineering.prompt KNOWN_VALUES rule).
const KNOWN_PREFIXES = ['bl868-fixture-', 'bl871-fixture-'];

// A pid far beyond any real pid table: the originating run is gone.
const GONE_PID = '99999999';
// Real child vitest under swarm load can far exceed the helper's default
// 30s; the scenario asserts the verdict, not the wall-clock.
const CHILD_TIMEOUT_MS = 120000;
const UNPREFIXED_PLANT = 'bl984-acceptance-unprefixed-plant.property.test.js';

function listPropertyFiles() {
  return fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.property.test.js'));
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^the property-lane fixture directory extension\/test\/$/, (ctx) => {
    if (!fs.existsSync(FIXTURE_DIR)) {
      throw new Error(`bl984: fixture directory missing: ${FIXTURE_DIR}`);
    }
    ctx.fixtureDir = FIXTURE_DIR;
  });

  registry.define(/^the fixture helper whose generated files match the lane include glob$/, (ctx) => {
    // The helper's whole reason to write into extension/test/ is that the
    // lane's include glob collects from there - bind that assumption to
    // the real config rather than assuming it.
    const configSource = fs.readFileSync(PROPERTIES_CONFIG_PATH, 'utf8');
    if (!configSource.includes('test/**/*.property.test.js')) {
      throw new Error('bl984: vitest.properties.config.mjs no longer includes test/**/*.property.test.js - the helper fixture placement assumption broke');
    }
  });

  // ── Givens ─────────────────────────────────────────────────────────
  registry.define(/^a leftover fixture file named for the prefix "([^"]+)" whose originating process is gone$/, (ctx, prefix) => {
    if (!KNOWN_PREFIXES.includes(prefix)) {
      throw new Error(`bl984: unrecognized <prefix> "${prefix}" - known: ${KNOWN_PREFIXES.join(', ')}`);
    }
    const strandPath = path.join(FIXTURE_DIR, `${prefix}${GONE_PID}-stranded984.property.test.js`);
    // A FAILING test: if the strand ever contributed to a run's verdict,
    // the verdict could not be clean - which is what scenario 01's second
    // Then asserts against.
    fs.writeFileSync(strandPath, "test('stranded - must never run', () => { throw new Error('a stranded fixture reached the lane'); });\n");
    ctx.strand = { path: strandPath, prefix };
  });

  registry.define(/^a fixture file carrying the helper's prefix whose originating process is still alive$/, (ctx) => {
    // A real sleeping child is the still-running peer; if this scenario is
    // killed before cleanup, the child dies on its own and the next sweep
    // claims the then-dead-pid file.
    ctx.peerChild = spawn('sleep', ['300'], { stdio: 'ignore' });
    const plantedPath = path.join(FIXTURE_DIR, `bl868-fixture-${ctx.peerChild.pid}-peer984.property.test.js`);
    fs.writeFileSync(plantedPath, "test('live peer fixture', () => {});\n");
    ctx.planted = plantedPath;
  });

  registry.define(/^a property test file in the fixture directory that does not carry the helper's prefix$/, (ctx) => {
    const plantedPath = path.join(FIXTURE_DIR, UNPREFIXED_PLANT);
    fs.rmSync(plantedPath, { force: true });
    fs.writeFileSync(plantedPath, "test('bl984 unprefixed plant - passing on purpose', () => {});\n");
    ctx.planted = plantedPath;
  });

  registry.define(/^the fixture directory holds no leftover fixtures$/, (ctx) => {
    for (const basenamePrefix of KNOWN_PREFIXES) {
      sweepStaleFixtures({ basenamePrefix });
    }
    ctx.baseline = listPropertyFiles();
  });

  // ── Whens ──────────────────────────────────────────────────────────
  registry.define(/^the fixture helper begins a run$/, (ctx) => {
    // Scenario 01 plants a strand and expects it swept: the run's own
    // fixture checks at CHILD time that the strand is already gone, which
    // proves the sweep ran before the child - not merely before this
    // step returned. Scenarios 02/03 plant survivors; a trivial fixture.
    const source = ctx.strand
      ? `const fs = require('node:fs');\ntest('bl984 own fixture', () => {\n  if (fs.existsSync(${JSON.stringify(ctx.strand.path)})) {\n    throw new Error('strand still present when the child ran');\n  }\n});\n`
      : "test('bl984 own fixture', () => {});\n";
    // The bl871 Examples row drives the multi-fixture entry point, the
    // bl868 row (and the plain scenarios) the single one - both wired.
    ctx.result = ctx.strand && ctx.strand.prefix === 'bl871-fixture-'
      ? runManyAsPropertyLaneFixtures([source], { timeout: CHILD_TIMEOUT_MS })
      : runAsPropertyLaneFixture(source, { timeout: CHILD_TIMEOUT_MS });
  });

  registry.define(/^the fixture helper completes a run normally$/, (ctx) => {
    ctx.result = runAsPropertyLaneFixture("test('bl984 own fixture', () => {});\n", { timeout: CHILD_TIMEOUT_MS });
    ctx.after = listPropertyFiles();
    if (ctx.result.status !== 0) {
      throw new Error(`bl984: expected a normal completion, got status ${ctx.result.status}\n${ctx.result.output}`);
    }
  });

  // ── Thens ──────────────────────────────────────────────────────────
  registry.define(/^the leftover fixture is removed before any new fixture is written$/, (ctx) => {
    if (fs.existsSync(ctx.strand.path)) {
      fs.rmSync(ctx.strand.path, { force: true });
      throw new Error('bl984: the stranded fixture survived the run - the sweep did not claim it');
    }
  });

  registry.define(/^the run's reported verdict is decided only by the fixtures it wrote itself$/, (ctx) => {
    // The strand is a throwing test and the run's own fixture passes (it
    // also proves child-time strand absence): a clean verdict is possible
    // only if the strand contributed nothing.
    if (ctx.result.status !== 0) {
      throw new Error(`bl984: expected a clean verdict from the run's own fixtures, got status ${ctx.result.status}\n${ctx.result.output}`);
    }
  });

  registry.define(/^that file is still present after the sweep$/, (ctx) => {
    const present = fs.existsSync(ctx.planted);
    if (ctx.peerChild) {
      ctx.peerChild.kill('SIGKILL');
    }
    fs.rmSync(ctx.planted, { force: true });
    if (!present) {
      throw new Error('bl984: the sweep claimed a file it must never touch');
    }
  });

  registry.define(/^the fixture it wrote is no longer present in the fixture directory$/, (ctx) => {
    const leftover = ctx.after.filter((name) => !ctx.baseline.includes(name));
    if (leftover.length > 0) {
      throw new Error(`bl984: the run left fixture(s) behind: ${JSON.stringify(leftover)}`);
    }
  });
}

module.exports = { registerSteps, KNOWN_PREFIXES, FIXTURE_DIR };
