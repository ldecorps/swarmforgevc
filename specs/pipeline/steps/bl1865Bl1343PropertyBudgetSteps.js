'use strict';

// BL-1865: step handlers for "bl1343's property tests finish well inside
// their budget". Amended 2026-10-01 (specifier, af48ba62ac, spec defect
// against BL-1658 D2 - the original 8000 ms fastest-of-three bound was a
// projection at mint, never measured on a fixed build): scenario 01 no
// longer asserts wall-clock time. It drives the REAL
// bl1343ReplayNeverDropsOwnPathInvariants.property.test.js once through the
// REAL vitest CLI under vitest.properties.config.mjs, with a `bb` shim
// placed first on PATH that logs one line per launch whose arguments
// reference land_step_lib.bb and then execs the real `bb` unchanged -
// counting the mechanism this ticket actually changed (one lib load per
// test, not once per draw) rather than a host-load-sensitive duration. A
// shim the run never reaches counts 0, so the exact-2 assertion is red, not
// vacuous (BL-1445). Scenario 02 is a source-level read, pinned against the
// file's own named constants for the same reason. Scenario 03 drives the
// REAL standing_red_register_cli.bb and the REAL backlog directories, since
// "present while open, absent once done" is a live ticket-state question,
// not a fixture.
//
// vitest.properties.config.mjs always prints one "[property-lane-budget]"
// diagnostic line to stdout before the JSON reporter's own line (module-body
// console.log, same stream, same process) - the JSON report is always the
// LAST line of stdout, so every parse here takes `out.trim().split('\n').pop()`
// rather than a bare JSON.parse(out).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = "BL-1865 bl1343's property tests finish well inside their budget";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
// BL-1636: a step handler that mkdtemps must register for reaping. This
// handler runs under node:test, not Vitest, so mkTmpDir's afterEach sweep
// never fires here - mkProcessTmpDir's process.once('exit', ...) cleanup
// does not depend on that lifecycle, and the shim dir is also removed
// explicitly in runOnceCountingBbLoads's own `finally` below.
const { mkProcessTmpDir } = require(path.join(EXTENSION_DIR, 'test', 'helpers', 'tmpDir'));
const TICKET = 'BL-1865';
const TARGET_FILE = 'extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js';
const TEST_FILE_REL = 'test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js';
const REGISTER_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'standing_red_register_cli.bb');
const LOAD_MARKER = 'LOAD';
const LOAD_MARKER_PATTERN = 'land_step_lib\\.bb';

function resolveRealBb() {
  return execFileSync('bash', ['-c', 'command -v bb'], { encoding: 'utf8' }).trim();
}

// A solo vitest run of TARGET_FILE, with a `bb` shim first on PATH that
// counts launches whose arguments reference land_step_lib.bb (the two
// landStepLibSession.js processes, one per test - the lib's own 54
// per-draw reloads this ticket replaces) and then execs the real `bb`
// unmodified, so the run's actual behavior and JSON report are unaffected.
function runOnceCountingBbLoads() {
  const realBb = resolveRealBb();
  const shimDir = mkProcessTmpDir('bl1865-bb-shim-');
  try {
    const logFile = path.join(shimDir, 'loads.log');
    fs.writeFileSync(logFile, '');
    const shimPath = path.join(shimDir, 'bb');
    fs.writeFileSync(
      shimPath,
      [
        '#!/bin/bash',
        `if printf '%s' "$*" | grep -q '${LOAD_MARKER_PATTERN}'; then`,
        `  printf '${LOAD_MARKER}\\n' >> "$BL1865_BB_SHIM_LOG"`,
        'fi',
        'exec "$BL1865_BB_SHIM_REAL_BB" "$@"',
        '',
      ].join('\n')
    );
    fs.chmodSync(shimPath, 0o755);

    const args = ['vitest', 'run', '--config', 'vitest.properties.config.mjs', TEST_FILE_REL, '--reporter=json'];
    const env = {
      ...process.env,
      PATH: `${shimDir}${path.delimiter}${process.env.PATH}`,
      BL1865_BB_SHIM_LOG: logFile,
      BL1865_BB_SHIM_REAL_BB: realBb,
    };
    let run;
    try {
      const out = execFileSync('npx', args, {
        cwd: EXTENSION_DIR,
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 16 * 1024 * 1024,
        env,
      });
      run = JSON.parse(out.trim().split('\n').pop());
    } catch (err) {
      const out = err.stdout ? err.stdout.toString() : '';
      const line = out.trim().split('\n').pop();
      assert.ok(line, `expected a JSON report line even from a failing run, got: ${err.message}`);
      run = JSON.parse(line);
    }
    const log = fs.readFileSync(logFile, 'utf8');
    const loadCount = log.split('\n').filter((l) => l === LOAD_MARKER).length;
    return { run, loadCount };
  } finally {
    fs.rmSync(shimDir, { recursive: true, force: true });
  }
}

function readRegisterReport() {
  const out = execFileSync('bb', [REGISTER_CLI, REPO_ROOT], { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out.trim().split('\n').pop());
}

function dirHasTicket(dir, ticketId) {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((name) => name === `${ticketId}.yaml` || name.startsWith(`${ticketId}-`));
}

function doneHasTicket(dir, ticketId) {
  if (!fs.existsSync(dir)) return false;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (doneHasTicket(full, ticketId)) return true;
    } else if (entry.name === `${ticketId}.yaml` || entry.name.startsWith(`${ticketId}-`)) {
      return true;
    }
  }
  return false;
}

// Mirrors standing_red_register_cli.bb's own real-ticket-state: open
// (paused or active) wins; backlog/done nests by milestone, so a recursive
// walk, never a flat glob.
function ticketIsOpen(ticketId) {
  return (
    dirHasTicket(path.join(REPO_ROOT, 'backlog', 'paused'), ticketId) ||
    dirHasTicket(path.join(REPO_ROOT, 'backlog', 'active'), ticketId)
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the bl1343 property file is run alone once with every bb launch counted$/, (ctx) => {
    ctx.bl1865Counted = runOnceCountingBbLoads();
  });

  scoped(/^both of its tests pass$/, (ctx) => {
    const { run } = ctx.bl1865Counted;
    assert.equal(run.numFailedTests, 0, `expected both tests to pass, got: ${JSON.stringify(run)}`);
    assert.equal(run.numTotalTests, 2, `expected exactly 2 tests, got numTotalTests=${run.numTotalTests}`);
  });

  scoped(/^land_step_lib\.bb is loaded exactly 2 times in that run$/, (ctx) => {
    const { loadCount } = ctx.bl1865Counted;
    assert.equal(
      loadCount,
      2,
      `expected land_step_lib.bb to be loaded exactly 2 times (once per test), got ${loadCount}`
    );
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the bl1343 property file's source is read$/, (ctx) => {
    ctx.bl1865Source = fs.readFileSync(path.join(REPO_ROOT, TARGET_FILE), 'utf8');
  });

  scoped(/^it declares exactly 2 tests$/, (ctx) => {
    const count = (ctx.bl1865Source.match(/^test\(/gm) || []).length;
    assert.equal(count, 2, `expected exactly 2 top-level test( declarations, got ${count}`);
  });

  scoped(
    /^each test runs runsPerCell\(27, SHAPES\.length\) draws for each of the shapes "([^"]+)", "([^"]+)" and "([^"]+)"$/,
    (ctx, s1, s2, s3) => {
      const src = ctx.bl1865Source;

      const shapesMatch = src.match(/const SHAPES = \[([^\]]*)\]/);
      assert.ok(shapesMatch, 'expected a "const SHAPES = [...]" array literal in the source');
      const shapes = shapesMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
      assert.deepEqual(shapes, [s1, s2, s3], `expected SHAPES to be [${s1}, ${s2}, ${s3}], got ${JSON.stringify(shapes)}`);

      const runsConstMatch = src.match(/const\s+(\w+)\s*=\s*runsPerCell\(27,\s*SHAPES\.length\)/);
      assert.ok(runsConstMatch, 'expected a const bound to runsPerCell(27, SHAPES.length)');
      const runsConstName = runsConstMatch[1];

      const usageCount = (src.match(new RegExp(`numRuns:\\s*${runsConstName}\\b`, 'g')) || []).length;
      assert.equal(
        usageCount,
        2,
        `expected both tests to pass { numRuns: ${runsConstName} }, got ${usageCount} usage(s)`
      );
    }
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the standing-red register is read$/, (ctx) => {
    ctx.bl1865Report = readRegisterReport();
  });

  scoped(
    /^the row for "([^"]+)" is present and owned by BL-1865 while BL-1865 is open, and absent once BL-1865 is in backlog\/done$/,
    (ctx, file) => {
      const row = ctx.bl1865Report.rows.find((r) => r.file === file);
      if (ticketIsOpen(TICKET)) {
        assert.ok(
          row,
          `expected a register row for ${file} while ${TICKET} is open, got rows: ${JSON.stringify(ctx.bl1865Report.rows)}`
        );
        assert.equal(row.ticket, TICKET, `expected the row's ticket to be ${TICKET}, got: ${JSON.stringify(row)}`);
        const unownedFiles = (ctx.bl1865Report.unowned || []).map((r) => r.file);
        assert.ok(
          !unownedFiles.includes(file),
          `expected ${file} not reported as unowned while ${TICKET} is open: ${JSON.stringify(ctx.bl1865Report.unowned)}`
        );
      } else {
        assert.ok(doneHasTicket(path.join(REPO_ROOT, 'backlog', 'done'), TICKET), `expected ${TICKET} to be in backlog/done`);
        assert.ok(!row, `expected no register row for ${file} once ${TICKET} is in backlog/done, got: ${JSON.stringify(row)}`);
      }
    }
  );
}

module.exports = { registerSteps };
