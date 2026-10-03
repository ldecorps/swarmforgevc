'use strict';

// BL-1910 declared invariant (coder first authorship - BL-654):
//   "Every process a confirmation starts has exited by the time
//    confirmPoleAlone returns, whatever its outcome."
//
// confirmPoleAlone starts processes only through testDurationRecorderLib.js's
// process-group runner (RUN_IN_OWN_GROUP_FLAG), so the property drives that
// runner exactly as confirmPoleAlone does: a spawnSync of the lib as a
// script. Each draw is a process tree under a leader:
// - the leader exits with a code, hangs past the timeout, or kills itself;
// - 0-3 children, each of which may ignore SIGTERM (so only the KILL ends
//   it), may start a grandchild, and may exit at once (so its grandchild is
//   orphaned to whatever adopts orphans here, out of every parent's reach,
//   but still in the group).
// Every process carries a marker unique to the draw in its environment.
// When the runner returns, no live process may carry it, and the exit code
// must be the one groupRunExitCode names for the leader's outcome.
// Two further draws run the REAL confirmPoleAlone, once timing out and once
// finishing, so the property holds of the function itself, not only of the
// runner.
//
// Collision candidates are constructed:
// - TERM-ignoring children under a leader that exits cleanly (the drain must
//   still escalate to KILL);
// - an orphaned grandchild under a leader that hangs (the group kill must
//   reach a process no parent tracks).
// Reach floor: every leader outcome, a TERM-ignoring child, and an orphaned
// grandchild occur.
//
// Stated limit: a descendant that calls setsid() leaves the group and is
// out of reach. Vitest and its pool fork plain children (tinypool), so no
// process a confirmation starts does that.
//
// Non-vacuity: with signalGroup addressing the leader's pid instead of the
// group (-pid), and the drain skipped, it fails at once ("left alive").
// Restored.
//
// Runs ONLY via `npm run test:properties`. Linux only (/proc).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  RUN_IN_OWN_GROUP_FLAG,
  GROUP_TIMEOUT_EXIT,
  GROUP_SIGNALLED_EXIT,
} = require('../scripts/testDurationRecorderLib');
const { confirmPoleAlone } = require('../scripts/recordTestDuration');

const LIB = path.join(__dirname, '..', 'scripts', 'testDurationRecorderLib.js');
const MARKER_VAR = 'BL1910_PROPERTY_MARKER';
const TIMEOUT_MS = 400;
const GRACE_MS = 200;

const CHILD_SRC = `
const c = JSON.parse(process.env.BL1910_CHILD);
if (c.ignoreTerm) process.on('SIGTERM', () => {});
if (c.grandchild) require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
if (c.exitAtOnce) process.exit(0);
setTimeout(() => {}, 60000);
`;

const LEADER_SRC = `
const { spawn } = require('child_process');
const spec = JSON.parse(process.env.BL1910_SPEC);
for (const c of spec.children) {
  spawn(process.execPath, ['-e', ${JSON.stringify(CHILD_SRC)}], { stdio: 'ignore', env: { ...process.env, BL1910_CHILD: JSON.stringify(c) } });
}
setTimeout(() => {
  if (spec.leader === 'exit') process.exit(spec.code);
  if (spec.leader === 'selfkill') process.kill(process.pid, 'SIGKILL');
}, 100);
setTimeout(() => {}, 60000);
`;

function markedAlive(marker) {
  const found = [];
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      if (!fs.readFileSync(`/proc/${pid}/environ`, 'utf8').includes(marker)) continue;
      const state = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').pop().split(' ')[0];
      if (state !== 'Z') found.push(Number(pid));
    } catch {
      /* gone, or not ours */
    }
  }
  return found;
}

function killAll(pids) {
  for (const p of pids) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
}

const child = fc.record({ ignoreTerm: fc.boolean(), grandchild: fc.boolean(), exitAtOnce: fc.boolean() });
const draw = fc.record({
  leader: fc.constantFrom('exit', 'hang', 'selfkill'),
  code: fc.integer({ min: 0, max: 3 }),
  children: fc.array(child, { maxLength: 3 }),
});

const EXAMPLES = [
  [{ leader: 'exit', code: 0, children: [{ ignoreTerm: true, grandchild: false, exitAtOnce: false }] }],
  [{ leader: 'hang', code: 0, children: [{ ignoreTerm: false, grandchild: true, exitAtOnce: true }] }],
  [{ leader: 'selfkill', code: 0, children: [{ ignoreTerm: true, grandchild: true, exitAtOnce: true }] }],
];

const linuxOnly = fs.existsSync('/proc/self/environ') ? test : test.skip;

linuxOnly(
  'BL-1910/BL-654 invariant: every process a confirmation starts has exited when it returns, whatever its outcome',
  () => {
    const reach = { exit: 0, hang: 0, selfkill: 0, ignoreTerm: 0, orphanGrand: 0 };
    let n = 0;
    fc.assert(
      fc.property(draw, (spec) => {
        const marker = `bl1910p-${process.pid}-${(n += 1)}-${Date.now()}`;
        const res = spawnSync(process.execPath, [LIB, RUN_IN_OWN_GROUP_FLAG, String(TIMEOUT_MS), String(GRACE_MS), process.execPath, '-e', LEADER_SRC], {
          encoding: 'utf8',
          timeout: 30000,
          env: { ...process.env, [MARKER_VAR]: marker, BL1910_SPEC: JSON.stringify(spec) },
        });
        const left = markedAlive(marker);
        killAll(left);
        assert.deepEqual(left, [], `left alive after the runner returned: ${JSON.stringify(spec)}`);
        const expected = { exit: spec.code, hang: GROUP_TIMEOUT_EXIT, selfkill: GROUP_SIGNALLED_EXIT }[spec.leader];
        assert.equal(res.status, expected, `${JSON.stringify(spec)} ${res.stderr}`);
        reach[spec.leader] += 1;
        if (spec.children.some((c) => c.ignoreTerm)) reach.ignoreTerm += 1;
        if (spec.children.some((c) => c.grandchild && c.exitAtOnce)) reach.orphanGrand += 1;
      }),
      { numRuns: 25, examples: EXAMPLES }
    );
    for (const k of Object.keys(reach)) assert.ok(reach[k] >= 1, `${k} reached: ${JSON.stringify(reach)}`);

    // The real confirmPoleAlone, timing out and finishing.
    for (const [sleepMs, opts] of [[60000, { timeoutMs: 2000 }], [100, {}]]) {
      const dir = mkTmpDir('sfvc-bl1910-prop-');
      const file = path.join(dir, 'bl1910-prop.test.js');
      fs.writeFileSync(file, `test('sleeps', async () => { await new Promise((r) => setTimeout(r, ${sleepMs})); }, ${sleepMs + 30000});\n`);
      const marker = `bl1910p-${process.pid}-confirm-${sleepMs}`;
      const before = process.env[MARKER_VAR];
      process.env[MARKER_VAR] = marker;
      let result;
      let left;
      try {
        result = confirmPoleAlone(file, opts);
        left = markedAlive(marker);
      } finally {
        if (before === undefined) delete process.env[MARKER_VAR];
        else process.env[MARKER_VAR] = before;
      }
      killAll(left);
      assert.deepEqual(left, [], `confirmPoleAlone left processes: ${JSON.stringify(result)}`);
      if (opts.timeoutMs) assert.match(String(result.failed), /timed out/);
      else assert.equal(typeof result.ms, 'number', JSON.stringify(result));
    }
  },
  180000
);
