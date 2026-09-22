'use strict';

// BL-1686: step handlers for "A fixture proves its root before git init,
// and no shell test sweeps a live sibling's tmproot". Drives the REAL
// prove_root/mk_fixture functions of test_bl1378_expedite_close_guard.sh
// and the REAL sweep_stale_prefix_roots helper of lib/tmp_cleanup.sh (via
// lib/bl1686FixtureProofBeforeInitCli.sh, which extracts/sources them by
// source position, never retypes them) - never a reimplementation.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE =
  "BL-1686 A fixture proves its root before git init, and no shell test sweeps a live sibling's tmproot";

const CLI = path.join(__dirname, 'lib', 'bl1686FixtureProofBeforeInitCli.sh');

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^a scratch working directory that is not a repository$/, (ctx) => {
    ctx.scratchCwd = mkSocketFixtureRoot('bl1686-scratch-');
  });

  scoped(
    /^the bl1378 test's tmproot created and then removed before its fixture builder runs$/,
    () => {
      // The CLI's own `vanished-tmproot` verb creates and removes its
      // TMPROOT itself, immediately before invoking mk_fixture - nothing
      // to stage here beyond the scratch cwd above.
    },
  );

  scoped(/^the fixture builder runs from that working directory$/, (ctx) => {
    ctx.result = spawnSync('bash', [CLI, 'vanished-tmproot', ctx.scratchCwd], { encoding: 'utf8' });
  });

  scoped(/^it refuses with the root proof's own message$/, (ctx) => {
    assert.notEqual(ctx.result.status, 0, `expected a non-zero exit, got 0: ${ctx.result.stdout}${ctx.result.stderr}`);
    const combined = `${ctx.result.stdout}${ctx.result.stderr}`;
    assert.match(combined, /refusing to mutate/, `expected the proof's own refusal text, got:\n${combined}`);
  });

  scoped(/^no git command ran and the working directory holds no repository$/, (ctx) => {
    assert.ok(!fs.existsSync(path.join(ctx.scratchCwd, '.git')), `expected no .git under ${ctx.scratchCwd} - the live-checkout incident shape`);
  });

  // ── Scenario Outline 02 ─────────────────────────────────────────────
  scoped(
    /^two temp roots under (\S+)'s prefix, one recording a live owner pid and one a dead pid$/,
    (ctx, file) => {
      ctx.targetFile = file;
      ctx.workDir = mkSocketFixtureRoot('bl1686-sweep-');
    },
  );

  scoped(/^(\S+)'s startup sweep runs$/, (ctx, file) => {
    assert.equal(file, ctx.targetFile, `expected the sweep to run for ${ctx.targetFile}, got ${file}`);
    ctx.result = spawnSync('bash', [CLI, 'sweep-reaps-dead-only', ctx.targetFile, ctx.workDir], { encoding: 'utf8' });
    assert.equal(ctx.result.status, 0, `expected exit 0, got ${ctx.result.status}: ${ctx.result.stdout}${ctx.result.stderr}`);
  });

  scoped(/^the live owner's root survives$/, (ctx) => {
    assert.match(ctx.result.stdout, /^LIVE_SURVIVED$/m, `expected LIVE_SURVIVED, got:\n${ctx.result.stdout}`);
  });

  scoped(/^the dead owner's root is removed$/, (ctx) => {
    assert.match(ctx.result.stdout, /^DEAD_REMOVED$/m, `expected DEAD_REMOVED, got:\n${ctx.result.stdout}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(
    /^the shell tests under swarmforge\/scripts\/test are grepped for the blind prefix sweep idiom$/,
    (ctx) => {
      ctx.censusResult = spawnSync('bash', [CLI, 'census'], { encoding: 'utf8' });
    },
  );

  scoped(/^it names no file$/, (ctx) => {
    const out = `${ctx.censusResult.stdout}${ctx.censusResult.stderr}`.trim();
    assert.equal(out, '', `expected the blind-sweep census to name no file, got:\n${out}`);
  });
}

module.exports = { registerSteps };
