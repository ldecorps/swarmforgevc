'use strict';

// BL-1273: step handlers for "self-heal telemetry has production emit sites
// again". Every check reads the REAL tree at the parcel commit and runs the
// REAL standing property test - never a restatement of what the emit sites
// should look like.
//
// The feature file says so itself: these are static checks over the tree and
// can pass over code that never executes. The live end-to-end (one real
// kill_all_swarm growing the month's ledger) is a manual step in the ticket's
// qa_e2e_procedure, because it needs a running swarm and tears it down.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');

const FEATURE_NAME = 'Self-heal telemetry has production emit sites again';

// BL-1262's half: the files this ticket's emits read from or shell into.
const RESTORED_FILES = [
  'swarmforge/scripts/self_heal_telemetry_lib.bb',
  'swarmforge/scripts/self_heal_telemetry_cli.bb',
  'extension/src/metrics/selfHealTelemetry.ts',
  'extension/src/metrics/selfHealTelemetryStore.ts',
];

// The prose-log line each emit was required to sit against - the anchor that
// proves the emit observes an EXISTING recovery site rather than introducing
// a second detection path (the ticket's firm "do NOT add a detector").
const PROSE_ANCHORS = {
  'stale-build-recompile': 'stale-build-detected',
  'supervisor-respawn': ':started (do',
  'claim-heal': 'in-process-resume-steps',
  'rotation-respawn': 'append-rotation-event!',
  kill_all: 'kill_all_swarm SUCCESS',
};

function hostText(host) {
  return fs.readFileSync(path.join(SCRIPTS, host), 'utf8');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^the repository at the parcel commit$/, (ctx) => {
    ctx.bl1273 = { scripts: SCRIPTS };
  });

  scoped(/^BL-1262's restored files are present$/, () => {
    const missing = RESTORED_FILES.filter((rel) => !fs.existsSync(path.join(REPO_ROOT, rel)));
    assert.deepEqual(missing, [], `BL-1262's half is not in the tree: ${missing.join(', ')}`);
  });

  // ── 01: each recovery host emits again ──────────────────────────────
  scoped(/^the recovery host (\S+)$/, (ctx, host) => {
    const full = path.join(SCRIPTS, host);
    assert.ok(fs.existsSync(full), `the recovery host ${host} does not exist`);
    ctx.bl1273.host = host;
  });

  scoped(/^its self-heal emit site is inspected$/, (ctx) => {
    ctx.bl1273.text = hostText(ctx.bl1273.host);
  });

  scoped(/^the host references (\S+)$/, (ctx, symbol) => {
    assert.ok(
      ctx.bl1273.text.includes(symbol),
      `${ctx.bl1273.host} does not reference ${symbol} - its emit is still missing`
    );
  });

  scoped(/^the emit sits at the existing prose log line for (\S+)$/, (ctx, eventType) => {
    const anchor = PROSE_ANCHORS[eventType];
    assert.ok(anchor, `no prose anchor is recorded for ${eventType}`);
    const lines = ctx.bl1273.text.split('\n');
    const anchorLine = lines.findIndex((line) => line.includes(anchor));
    assert.ok(anchorLine >= 0, `${ctx.bl1273.host} no longer carries the prose log line for ${eventType}`);
    // The emit must be adjacent to that anchor, not merely somewhere in the
    // file: a call at the other end of the host would satisfy "references"
    // while observing something else entirely.
    const window = lines.slice(anchorLine, anchorLine + 12).join('\n');
    assert.match(
      window,
      /append-self-heal-event!|self_heal_telemetry_cli\.bb/,
      `${ctx.bl1273.host}: the ${eventType} emit is not at its prose log line "${anchor}"`
    );
    // "the right function near the right anchor" alone would still pass a
    // call carrying the WRONG (or blank) :type - e.g. handoffd.bb's
    // claim-heal call rewritten with :type "" satisfies both checks above.
    // For the four bb sites that pass a structured {:type "..."} map, pin
    // the literal itself. kill_pipeline_swarm.sh's CLI-shell site carries no
    // :type map (it passes a reason string to a different action-map
    // vocabulary, a known pre-existing divergence out of this ticket's
    // scope per the coder's own note) so it is exempt here.
    if (ctx.bl1273.host.endsWith('.bb')) {
      assert.match(
        window,
        new RegExp(`:type\\s+"${eventType}"`),
        `${ctx.bl1273.host}: the emit near "${anchor}" does not carry :type "${eventType}"`
      );
    }
  });

  // ── 02: no host loads the lib without calling it ────────────────────
  scoped(/^every script under swarmforge\/scripts at the parcel commit$/, (ctx) => {
    ctx.bl1273.allScripts = fs
      .readdirSync(SCRIPTS)
      .filter((name) => /\.(bb|sh)$/.test(name))
      .filter((name) => fs.statSync(path.join(SCRIPTS, name)).isFile());
  });

  scoped(/^the scripts that load self_heal_telemetry_lib\.bb are collected$/, (ctx) => {
    ctx.bl1273.loaders = ctx.bl1273.allScripts.filter((name) => {
      if (name === 'self_heal_telemetry_lib.bb') {
        return false; // the lib is not a loader of itself
      }
      return /load-file[^\n]*self_heal_telemetry_lib\.bb/.test(hostText(name));
    });
    assert.ok(ctx.bl1273.loaders.length > 0, 'no script loads the telemetry lib at all - nothing to check');
  });

  scoped(/^every collected script also calls append-self-heal-event!$/, (ctx) => {
    const dead = ctx.bl1273.loaders.filter((name) => !hostText(name).includes('append-self-heal-event!'));
    assert.deepEqual(
      dead,
      [],
      `these scripts load the telemetry lib without calling it - a dead dependency edge: ${dead.join(', ')}`
    );
  });

  // ── 03: the standing property test passes ───────────────────────────
  scoped(/^the property suite command for the extension$/, (ctx) => {
    ctx.bl1273.propertyTest = 'test/selfHealTelemetry.property.test.js';
  });

  scoped(/^selfHealTelemetry\.property\.test\.js is run$/, (ctx) => {
    const reportPath = path.join(EXTENSION_DIR, '.vitest-bl1273-report.json');
    fs.rmSync(reportPath, { force: true });
    try {
      execFileSync(
        path.join(EXTENSION_DIR, 'node_modules', '.bin', 'vitest'),
        [
          'run',
          '--config',
          'vitest.properties.config.mjs',
          ctx.bl1273.propertyTest,
          '--reporter=json',
          `--outputFile=${reportPath}`,
        ],
        { cwd: EXTENSION_DIR, stdio: 'ignore' }
      );
    } catch {
      // A red suite exits non-zero; the report below carries the per-test
      // verdicts either way, and PASSING is what the scenario asserts.
    }
    assert.ok(fs.existsSync(reportPath), 'the property run produced no report');
    ctx.bl1273.report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    fs.rmSync(reportPath, { force: true });
  });

  function assertNamedTestPassed(ctx, needle) {
    const results = (ctx.bl1273.report.testResults || []).flatMap((f) => f.assertionResults || []);
    const match = results.filter((r) => r.title.includes(needle));
    assert.ok(match.length > 0, `no test matching "${needle}" ran - it must PASS, not merely collect`);
    const failed = match.filter((r) => r.status !== 'passed');
    assert.deepEqual(
      failed.map((r) => r.title),
      [],
      `these tests did not pass: ${failed.map((r) => `${r.title} (${r.status})`).join(', ')}`
    );
  }

  scoped(/^its known-emit-hosts invariant passes$/, (ctx) => {
    assertNamedTestPassed(ctx, 'call sites are only known recovery hosts');
  });

  scoped(/^its every-known-host-loads-the-shared-lib invariant passes$/, (ctx) => {
    assertNamedTestPassed(ctx, 'every known host still loads the shared lib');
  });
}

module.exports = { registerSteps };
