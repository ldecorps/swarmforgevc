'use strict';

// BL-1910: step handlers for "A pole confirmation leaves no process behind".
// Drives the REAL confirmPoleAlone (extension/scripts/recordTestDuration.js)
// in-process, as npm test's recorder does. The fixture test file lives in a
// tracked mkdtemp directory outside extension/test/ (BL-1390, as BL-1633's
// scenario 03 does). Every process the confirmation starts inherits a marker
// in its environment, unique to the scenario, set on this process for the
// length of the call only. Afterwards no live process may carry it. Command
// lines cannot be used for this: vitest's workers do not name the test file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'A pole confirmation leaves no process behind';
const RECORDER = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'recordTestDuration.js');
const MARKER_VAR = 'BL1910_CONFIRMATION_MARKER';
// Scenario 01 shortens the timeout through confirmPoleAlone's own seam.
const SHORT_TIMEOUT_MS = 3000;

// KNOWN_VALUES: the fixture shapes the Givens name.
const FIXTURES = {
  'runs longer than the confirmation\'s timeout': { sleepMs: 60000, timeoutMs: SHORT_TIMEOUT_MS },
  'sleeps 200 ms': { sleepMs: 200, timeoutMs: undefined },
};

function writeFixture(ctx, shape) {
  const fx = FIXTURES[shape];
  assert.ok(fx, `unknown fixture shape: ${shape}`);
  const dir = trackedTmpRoot('sfvc-bl1910-');
  const file = path.join(dir, 'bl1910-fixture.test.js');
  fs.writeFileSync(
    file,
    `test('bl1910 fixture sleeps ${fx.sleepMs} ms', async () => {\n` +
      `  await new Promise((resolve) => setTimeout(resolve, ${fx.sleepMs}));\n` +
      `}, ${fx.sleepMs + 30000});\n`
  );
  ctx.bl1910 = { dir, file, ...fx, marker: `bl1910-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}` };
}

// Live (non-zombie) pids whose environment carries the marker.
function markedProcesses(marker) {
  if (fs.existsSync('/proc/self/environ')) {
    const found = [];
    for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
      try {
        if (!fs.readFileSync(`/proc/${pid}/environ`, 'utf8').includes(marker)) continue;
        const state = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').pop().split(' ')[0];
        if (state !== 'Z') found.push(Number(pid));
      } catch {
        /* gone, or not ours to read */
      }
    }
    return found;
  }
  // macOS: ps eww prints each process's environment after its command.
  const ps = spawnSync('ps', ['-axww', '-e', '-o', 'pid=,stat=,command='], { encoding: 'utf8' });
  return (ps.stdout || '')
    .split('\n')
    .filter((l) => l.includes(marker) && !/^\s*\d+\s+Z/.test(l))
    .map((l) => Number(l.trim().split(/\s+/)[0]));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture test file that (runs longer than the confirmation's timeout|sleeps 200 ms)$/, (ctx, shape) => {
    writeFixture(ctx, shape);
  });

  scoped(/^confirmPoleAlone confirms it$/, (ctx) => {
    const fx = ctx.bl1910;
    const { confirmPoleAlone } = require(RECORDER);
    const before = process.env[MARKER_VAR];
    process.env[MARKER_VAR] = fx.marker;
    try {
      fx.result = confirmPoleAlone(fx.file, fx.timeoutMs === undefined ? {} : { timeoutMs: fx.timeoutMs });
      // Read at once: the claim is "by the time it returns", never after a wait.
      fx.left = markedProcesses(fx.marker);
    } finally {
      if (before === undefined) delete process.env[MARKER_VAR];
      else process.env[MARKER_VAR] = before;
      fs.rmSync(fx.dir, { recursive: true, force: true });
    }
  });

  scoped(/^it returns a failed confirmation that names the timeout$/, (ctx) => {
    const { result } = ctx.bl1910;
    assert.ok(result && typeof result.failed === 'string', `expected {failed}, got ${JSON.stringify(result)}`);
    assert.match(result.failed, new RegExp(`timed out after ${SHORT_TIMEOUT_MS}ms`), result.failed);
  });

  scoped(/^it returns a measured duration of at least 200 ms$/, (ctx) => {
    const { result } = ctx.bl1910;
    assert.ok(result && typeof result.ms === 'number', `expected {ms}, got ${JSON.stringify(result)}`);
    assert.ok(result.ms >= 200, `measured ${result.ms} ms`);
  });

  scoped(/^no process the confirmation started is still running$/, (ctx) => {
    const { left, marker } = ctx.bl1910;
    if (left.length) {
      const detail = left.map((p) => {
        try {
          return `${p}: ${fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').replace(/\0/g, ' ')}`;
        } catch {
          return String(p);
        }
      });
      // Never leave them running for the next scenario either.
      for (const p of left) {
        try {
          process.kill(p, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
      assert.fail(`processes marked ${marker} outlived the confirmation:\n${detail.join('\n')}`);
    }
  });
}

module.exports = { registerSteps };
