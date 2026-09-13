'use strict';

// BL-1503: the bl1313 property test copies the load-file closure it computes,
// never a hand-typed list. Scenario 01 drives the REAL property file under
// the REAL properties config; scenario 02 drives the REAL closure helper
// against the REAL scripts tree and reads the REAL property test source -
// nothing here re-derives the closure by hand.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { computeClosure } = require('./lib/operatorRuntimeBbClosure.js');

const FEATURE = 'BL-1503 The bl1313 property test copies the closure it computes, never a list';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PROPERTY_TEST_REL = 'test/bl1313BatchGuardVisibilityInvariants.property.test.js';
const PROPERTY_TEST_FILE = path.join(EXTENSION_DIR, PROPERTY_TEST_REL);

// The eleven files the retired hand-typed LIB_CLOSURE list named (mint-time
// census, ticket description). Kept here as the frozen SHAPE the retired
// list had, not re-read from the property file - the property file no
// longer names them as a list at all.
const RETIRED_HAND_LIST = [
  'handoff_lib.bb',
  'duplicate_chain_guard_lib.bb',
  'pipeline_stage_lib.bb',
  'ambulance_lib.bb',
  'shell_quote_lib.bb',
  'daemon_cycle_guard_lib.bb',
  'mono_router_lib.bb',
  'prompt_engine_lib.bb',
  'rotation_telemetry_lib.bb',
  'seat_difficulty_lib.bb',
  'self_heal_telemetry_lib.bb',
];

// Quoted string literals ending in `_lib.bb` - single- or double-quoted,
// matching a JS string literal, never a bare prose mention (the header
// comment names both libs without quotes and must not trip this).
const QUOTED_LIB_LITERAL_RE = /['"]([A-Za-z0-9_]+_lib\.bb)['"]/g;

function quotedLibLiterals(sourceText) {
  const found = new Set();
  let match;
  QUOTED_LIB_LITERAL_RE.lastIndex = 0;
  while ((match = QUOTED_LIB_LITERAL_RE.exec(sourceText))) {
    found.add(match[1]);
  }
  return found;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ───────────────────────────────────────────────────────────
  scoped(
    /^extension\/test\/bl1313BatchGuardVisibilityInvariants\.property\.test\.js runs alone under the properties config$/,
    (ctx) => {
      const result = spawnSync(
        'npx',
        ['vitest', 'run', '--config', 'vitest.properties.config.mjs', PROPERTY_TEST_REL],
        { cwd: EXTENSION_DIR, encoding: 'utf8', timeout: 600000 }
      );
      ctx.bl1503 = ctx.bl1503 || {};
      ctx.bl1503.exit = result.status;
      ctx.bl1503.output = `${result.stdout || ''}${result.stderr || ''}`;
    }
  );

  scoped(/^every test in it passes$/, (ctx) => {
    assert.equal(
      ctx.bl1503.exit,
      0,
      `bl1313 property file did not pass:\n${(ctx.bl1503.output || '').slice(-4000)}`
    );
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────
  scoped(
    /^the load-file closure of handoff_lib\.bb and duplicate_chain_guard_lib\.bb is computed from the scripts tree$/,
    (ctx) => {
      ctx.bl1503 = ctx.bl1503 || {};
      ctx.bl1503.closure = new Set([
        ...computeClosure(SCRIPTS_DIR, 'handoff_lib.bb'),
        ...computeClosure(SCRIPTS_DIR, 'duplicate_chain_guard_lib.bb'),
      ]);
    }
  );

  scoped(/^it contains respawn_bootstrap_lib\.bb$/, (ctx) => {
    assert.ok(
      ctx.bl1503.closure.has('respawn_bootstrap_lib.bb'),
      `computed closure is missing respawn_bootstrap_lib.bb: ${[...ctx.bl1503.closure].sort().join(', ')}`
    );
  });

  scoped(/^it contains every one of the eleven files the retired hand list named$/, (ctx) => {
    assert.equal(
      RETIRED_HAND_LIST.length,
      11,
      'the retired hand list this handler pins is not eleven files - the handler drifted from the ticket'
    );
    const missing = RETIRED_HAND_LIST.filter((name) => !ctx.bl1503.closure.has(name));
    assert.deepEqual(
      missing,
      [],
      `computed closure is missing files the retired hand list named: ${missing.join(', ')}`
    );
  });

  scoped(
    /^the property file names only handoff_lib\.bb and duplicate_chain_guard_lib\.bb as quoted lib literals$/,
    () => {
      const source = fs.readFileSync(PROPERTY_TEST_FILE, 'utf8');
      const literals = quotedLibLiterals(source);
      assert.deepEqual(
        [...literals].sort(),
        ['duplicate_chain_guard_lib.bb', 'handoff_lib.bb'],
        `property file names these quoted lib literals: ${[...literals].sort().join(', ')}`
      );
    }
  );
}

module.exports = { registerSteps };
