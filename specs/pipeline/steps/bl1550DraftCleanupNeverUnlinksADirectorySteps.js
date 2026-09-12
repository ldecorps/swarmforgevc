'use strict';

// BL-1550: step handlers for "a draft cleanup never unlinks a directory".
// Scenario 01 drives the REAL property file as a real subprocess under the
// properties config - the only way to prove the file itself is green, not
// a restatement of it (same discipline as bl1534BoundedSweepReachSteps.js).
// Scenario 02 drives the REAL compiled helper (extension/out/swarm/
// draftPathUnder.js) against a real mkdtemp fixture, twice per row, to
// prove idempotency and the directory-preserving contract directly.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = 'BL-1550 A draft cleanup never unlinks a directory';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION = path.join(REPO_ROOT, 'extension');
const PROPERTY_TEST_REL = 'test/draftPathUnder.property.test.js';

function draftPathUnderModule() {
  // Required lazily (and freshly per row) so a fixture built with a stale
  // compiled helper never masquerades as a pass - the real path every
  // production sender loads from, not a TS re-implementation.
  delete require.cache[require.resolve(path.join(EXTENSION, 'out', 'swarm', 'draftPathUnder.js'))];
  return require(path.join(EXTENSION, 'out', 'swarm', 'draftPathUnder.js'));
}

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const KNOWN_STATES = new Set(['a regular file', 'nothing', 'an empty directory', 'a directory holding a file']);
const KNOWN_AFTERS = new Set([
  'the path no longer exists',
  'the directory still exists',
  'the directory and its file still exist',
]);

function buildState(state) {
  const dir = mkProcessTmpDir('bl1550-scenario02-');
  const draftPath = path.join(dir, 'draft-path');
  let innerFile = null;
  if (state === 'a regular file') {
    fs.writeFileSync(draftPath, 'type: note\n');
  } else if (state === 'nothing') {
    // draftPath does not exist.
  } else if (state === 'an empty directory') {
    fs.mkdirSync(draftPath);
  } else if (state === 'a directory holding a file') {
    fs.mkdirSync(draftPath);
    innerFile = path.join(draftPath, 'inner');
    fs.writeFileSync(innerFile, 'x');
  } else {
    throw new Error(`unknown state example value: "${state}"`);
  }
  return { dir, draftPath, innerFile };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ───────────────────────────────────────────────────────────

  scoped(/^extension\/test\/draftPathUnder\.property\.test\.js runs alone under the properties config$/, (ctx) => {
    if (!ctx.bl1550PropertyRun) {
      ctx.bl1550PropertyRun = spawnSync(
        'npx',
        ['vitest', 'run', '--config', 'vitest.properties.config.mjs', PROPERTY_TEST_REL],
        { cwd: EXTENSION, encoding: 'utf8' }
      );
    }
  });

  scoped(/^every test in it passes$/, (ctx) => {
    const result = ctx.bl1550PropertyRun;
    assert.equal(
      result.status,
      0,
      `expected ${PROPERTY_TEST_REL} to pass under the properties config, got:\n${result.stdout}${result.stderr}`
    );
  });

  // ── Scenario 02 (Outline) ────────────────────────────────────────────────

  scoped(
    /^(a regular file|nothing|an empty directory|a directory holding a file) at the draft path$/,
    (ctx, state) => {
      if (!KNOWN_STATES.has(state)) {
        throw new Error(`unknown state example value: "${state}"`);
      }
      ctx.bl1550State = buildState(state);
    }
  );

  scoped(/^the draft cleanup runs twice on that path$/, (ctx) => {
    const { removeDraftIfPresent } = draftPathUnderModule();
    const draftPath = ctx.bl1550State.draftPath;
    const thrown = [];
    for (let i = 0; i < 2; i += 1) {
      try {
        removeDraftIfPresent(draftPath);
      } catch (err) {
        thrown.push(err);
      }
    }
    ctx.bl1550Thrown = thrown;
  });

  scoped(/^neither call throws$/, (ctx) => {
    assert.equal(
      ctx.bl1550Thrown.length,
      0,
      `expected neither call to throw, got: ${ctx.bl1550Thrown.map((e) => e.message).join('; ')}`
    );
  });

  scoped(
    /^(the path no longer exists|the directory still exists|the directory and its file still exist)$/,
    (ctx, after) => {
      if (!KNOWN_AFTERS.has(after)) {
        throw new Error(`unknown after example value: "${after}"`);
      }
      const state = ctx.bl1550State;
      if (after === 'the path no longer exists') {
        assert.equal(fs.existsSync(state.draftPath), false, `expected ${state.draftPath} to no longer exist`);
      } else if (after === 'the directory still exists') {
        assert.ok(fs.existsSync(state.draftPath), `expected ${state.draftPath} to still exist`);
        assert.ok(fs.statSync(state.draftPath).isDirectory(), `expected ${state.draftPath} to still be a directory`);
      } else if (after === 'the directory and its file still exist') {
        assert.ok(fs.existsSync(state.draftPath), `expected ${state.draftPath} to still exist`);
        assert.ok(fs.statSync(state.draftPath).isDirectory(), `expected ${state.draftPath} to still be a directory`);
        assert.ok(fs.existsSync(state.innerFile), `expected ${state.innerFile} to still exist`);
      }
    }
  );
}

module.exports = { registerSteps };
