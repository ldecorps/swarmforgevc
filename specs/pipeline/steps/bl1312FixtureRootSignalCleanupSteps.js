'use strict';

// BL-1312: step handlers for the two-mode probe qa_e2e_procedure describes,
// driving the REAL specs/pipeline/steps/lib/socketFixtureRoot.js against a
// REAL spawned child process sent a REAL signal - the defect (cleanup that
// only fires by accident of which other file is loaded in the same
// process) cannot be observed any other way, since a bare
// process.on('exit') hook not firing is invisible from inside the very
// process it fails to protect.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const FEATURE = 'A fixture root survives SIGTERM whenever no other step file happens to install a reaper';

const HELPER_PATH = path.join(__dirname, 'lib', 'socketFixtureRoot.js');
const PROBE_CLI = path.join(__dirname, 'lib', 'bl1312FixtureRootSignalProbeCli.js');

function spawnProbe(args) {
  return spawn(process.execPath, [PROBE_CLI, ...args], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

// Resolves with the parsed `ROOTS:a,b,c` line once the probe has actually
// created every root it was asked to - never a fixed delay, so this never
// races the probe's own startup cost.
function waitForRoots(child) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/ROOTS:([^\n]*)\n/);
      if (m) {
        child.stdout.off('data', onData);
        resolve(m[1].split(',').filter(Boolean));
      }
    };
    child.stdout.on('data', onData);
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!buf.includes('ROOTS:')) {
        reject(new Error(`probe exited (code ${code}) before printing its roots; stdout so far: ${JSON.stringify(buf)}`));
      }
    });
  });
}

// Resolves with the full stdout captured up to and including process exit.
function waitForExit(child) {
  return new Promise((resolve) => {
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
    });
    child.once('exit', () => resolve(buf));
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  scoped(/^another step file has (not|already) installed a fixtureReaper handler$/, (ctx, otherHandler) => {
    ctx.bl1312 = { otherHandler };
  });

  scoped(/^a node process has created a fixture root with mkSocketFixtureRoot$/, async (ctx) => {
    const child = spawnProbe([HELPER_PATH, 'idle', ctx.bl1312.otherHandler, '1']);
    ctx.bl1312.child = child;
    const roots = await waitForRoots(child);
    assert.equal(roots.length, 1, `expected the probe to report exactly one root, got: ${JSON.stringify(roots)}`);
    ctx.bl1312.root = roots[0];
  });

  scoped(/^the process is sent (SIGTERM|SIGINT)$/, async (ctx, signal) => {
    const { child } = ctx.bl1312;
    const exited = waitForExit(child);
    child.kill(signal);
    await exited;
  });

  scoped(/^the fixture root no longer exists$/, (ctx) => {
    assert.equal(
      fs.existsSync(ctx.bl1312.root),
      false,
      `expected fixture root ${ctx.bl1312.root} to be removed after the signal, but it still exists`
    );
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^a node process has created four fixture roots with mkSocketFixtureRoot$/, async (ctx) => {
    ctx.bl1312 = ctx.bl1312 || {};
    const child = spawnProbe([HELPER_PATH, 'count', 'not', '4']);
    const out = await waitForExit(child);
    const rootsMatch = out.match(/ROOTS:([^\n]*)\n/);
    const sigintMatch = out.match(/SIGINT:(\d+)/);
    const sigtermMatch = out.match(/SIGTERM:(\d+)/);
    assert.ok(rootsMatch, `expected the probe to report its roots, got stdout: ${JSON.stringify(out)}`);
    const roots = rootsMatch[1].split(',').filter(Boolean);
    assert.equal(roots.length, 4, `expected 4 fixture roots, got: ${JSON.stringify(roots)}`);
    assert.ok(sigintMatch && sigtermMatch, `expected listener counts in stdout, got: ${JSON.stringify(out)}`);
    ctx.bl1312.sigintCount = Number(sigintMatch[1]);
    ctx.bl1312.sigtermCount = Number(sigtermMatch[1]);
  });

  scoped(/^the process has exactly one SIGINT listener and one SIGTERM listener$/, (ctx) => {
    assert.equal(ctx.bl1312.sigintCount, 1, `expected exactly 1 SIGINT listener, got ${ctx.bl1312.sigintCount}`);
    assert.equal(ctx.bl1312.sigtermCount, 1, `expected exactly 1 SIGTERM listener, got ${ctx.bl1312.sigtermCount}`);
  });
}

module.exports = { registerSteps };
