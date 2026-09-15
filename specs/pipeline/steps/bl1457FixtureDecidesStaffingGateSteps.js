'use strict';

// BL-1457: the two property files that drive the launcher's parse_config on
// a fixture root with no role matrix decide BL-1318's staffing-gate hatch
// (PACK_STAFFING_SKIP_GATE) themselves, inside the environment they spawn,
// never inheriting it from the pane - the vitest-lane sibling of BL-1445
// (shell wiring) and BL-1486 (acceptance handlers). Scenarios 01/03 drive
// the REAL vitest run of each named file under a controlled child
// environment (the variable explicitly set or removed, never merely
// inherited from THIS process, which is itself run under whatever a role's
// own pane exports). Scenario 02 is structural. Scenario 04 checks the
// standing-red register.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const STANDING_REDS = path.join(REPO_ROOT, 'backlog', 'standing-reds.tsv');

const FEATURE =
  "BL-1457 Every test that drives the launcher's parse_config on a fixture decides the staffing gate itself";

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

// Property files run only via the properties lane's own vitest config
// (extension/vitest.properties.config.mjs, npm run test:properties);
// everything else runs under the default unit config.
function laneConfigFor(relativeFile) {
  return relativeFile.endsWith('.property.test.js') ? 'vitest.properties.config.mjs' : 'vitest.config.mjs';
}

function runFileUnderItsLane(file, env) {
  const relative = file.startsWith('extension/') ? file.slice('extension/'.length) : file;
  const config = laneConfigFor(relative);
  const r = spawnSync('npx', ['vitest', 'run', '--config', config, relative], {
    encoding: 'utf8',
    timeout: 180000,
    cwd: EXTENSION_DIR,
    env,
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function registerSteps(registry) {
  // ── givens: what the ambient environment carries ────────────────────
  scoped(registry, /^the environment exports PACK_STAFFING_SKIP_GATE as (unset|1)$/, (ctx, value) => {
    const env = { ...process.env };
    delete env.PACK_STAFFING_SKIP_GATE;
    if (value === '1') env.PACK_STAFFING_SKIP_GATE = '1';
    ctx.laneEnv = env;
  });

  scoped(registry, /^the environment does not export PACK_STAFFING_SKIP_GATE$/, (ctx) => {
    const env = { ...process.env };
    delete env.PACK_STAFFING_SKIP_GATE;
    ctx.laneEnv = env;
  });

  // ── scenarios 01/03: run the file, check the verdict ─────────────────
  scoped(registry, /^(\S+) runs alone under its lane's runner$/, (ctx, file) => {
    ctx.fileResult = runFileUnderItsLane(file, ctx.laneEnv);
  });

  scoped(registry, /^every test in it passes$/, (ctx) => {
    assert.equal(ctx.fileResult.status, 0, `expected every test to pass:\n${ctx.fileResult.out}`);
  });

  // ── scenario 02 ────────────────────────────────────────────────────
  scoped(registry, /^the vitest configurations under extension are inspected$/, (ctx) => {
    const files = fs.readdirSync(EXTENSION_DIR).filter((f) => /^vitest.*\.config\.mjs$/.test(f));
    ctx.vitestConfigs = files.map((f) => ({ path: f, content: fs.readFileSync(path.join(EXTENSION_DIR, f), 'utf8') }));
  });

  scoped(registry, /^none of them exports PACK_STAFFING_SKIP_GATE into every test's environment$/, (ctx) => {
    assert.ok(ctx.vitestConfigs.length > 0, 'expected at least one vitest config under extension');
    for (const { path: p, content } of ctx.vitestConfigs) {
      assert.doesNotMatch(
        content,
        /PACK_STAFFING_SKIP_GATE/,
        `${p} mentions PACK_STAFFING_SKIP_GATE - a lane-wide export here would blind every test that asserts on the gate`
      );
    }
  });

  // ── scenario 04 ────────────────────────────────────────────────────
  scoped(registry, /^the fix is on main$/, (ctx) => {
    ctx.marker = true;
  });

  scoped(registry, /^backlog\/standing-reds\.tsv carries no row for either file$/, () => {
    const content = fs.readFileSync(STANDING_REDS, 'utf8');
    assert.doesNotMatch(
      content,
      /bl1218RemoteControlConfigInvariants\.property\.test\.js/,
      'standing-reds.tsv still carries a row for bl1218RemoteControlConfigInvariants.property.test.js'
    );
    assert.doesNotMatch(
      content,
      /bl1320DocumentedStepsAreExecutedInvariants\.property\.test\.js/,
      'standing-reds.tsv still carries a row for bl1320DocumentedStepsAreExecutedInvariants.property.test.js'
    );
  });
}

module.exports = { registerSteps };
