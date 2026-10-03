'use strict';

// BL-1907: step handlers for "An orphan adopted by a subreaper is an orphan".
// Scenario 01: a Python fixture process makes itself a child subreaper
// (prctl PR_SET_CHILD_SUBREAPER). It starts a starter that starts the target,
// and then runs the REAL process_table_lib.bb parent-orphaned? on the target
// as its own child, because a reaper shares its adopter only with the
// processes below the same subreaper. Every process the fixture starts is
// killed by pid in a finally, never by pattern (BL-1385).
// Scenario 02: each standing shell test runs under the same kind of fixture
// subreaper. Its orphans are then adopted by a live non-1 process on any
// Linux host, which is the WSL Relay /init condition. On a host whose
// orphans go to PID 1 a plain run would prove nothing. Anything the test
// leaves adopted by the wrapper is killed by pid when it ends, and the
// wrapper reaps each adopted child as it exits, as a real adopter does.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'An orphan adopted by a subreaper is an orphan';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const TEST_DIR = path.join(SCRIPTS_DIR, 'test');

// The fixture subreaper's shared preamble: become a subreaper, and on the
// way out kill every live child the kernel has handed it, by pid.
const SUBREAPER_PREAMBLE = `
import ctypes, os, signal, sys, time
PR_SET_CHILD_SUBREAPER = 36
if ctypes.CDLL(None).prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
    print("NO_SUBREAPER"); sys.exit(3)
def adopted_children():
    kids = []
    for task in os.listdir("/proc/self/task"):
        try:
            with open(f"/proc/self/task/{task}/children") as f:
                kids += [int(p) for p in f.read().split()]
        except OSError:
            pass
    return kids
def kill_pids(pids):
    for p in pids:
        try:
            os.kill(p, signal.SIGKILL)
        except ProcessLookupError:
            pass
    for p in pids:
        try:
            os.waitpid(p, 0)
        except ChildProcessError:
            pass
def ppid_of(pid):
    with open(f"/proc/{pid}/stat") as f:
        return int(f.read().rsplit(")", 1)[1].split()[1])
`;

// Scenario 01's fixture. argv: mode (adopted|live), process_table_lib path.
const PREDICATE_FIXTURE = `${SUBREAPER_PREAMBLE}
import subprocess
mode, lib = sys.argv[1], sys.argv[2]
r, w = os.pipe()
starter = os.fork()
if starter == 0:
    os.close(r)
    target = os.fork()
    if target == 0:
        os.close(w)
        time.sleep(60)
        os._exit(0)
    os.write(w, str(target).encode()); os.close(w)
    if mode == "adopted":
        os._exit(0)
    time.sleep(60)
    os._exit(0)
os.close(w)
target = int(os.read(r, 32).decode()); os.close(r)
expected_parent = os.getpid() if mode == "adopted" else starter
try:
    if mode == "adopted":
        os.waitpid(starter, 0)
    for _ in range(200):
        if ppid_of(target) == expected_parent:
            break
        time.sleep(0.01)
    parent = ppid_of(target)
    out = subprocess.run(["bb", "-e",
        f'(load-file "{lib}") (println (process-table-lib/parent-orphaned? {target}))'],
        capture_output=True, text=True, timeout=60)
    print(f"PARENT {parent} SUBREAPER {os.getpid()} STARTER {starter}")
    print(f"ORPHANED {out.stdout.strip()}")
    sys.stderr.write(out.stderr)
finally:
    kill_pids([target, starter] + adopted_children())
`;

// Scenario 02's wrapper. argv: the test script; runs it, exits with its code.
// Like any real adopter (WSL's Relay /init, PID 1) it reaps every child it
// is handed as soon as it exits. An unreaped zombie still answers kill -0,
// so a test's "the orphan was reaped" check would never pass.
const TEST_WRAPPER = `${SUBREAPER_PREAMBLE}
import subprocess
test = subprocess.Popen(["bash", sys.argv[1]])
code = 1
try:
    while True:
        pid, status = os.waitpid(-1, 0)
        if pid == test.pid:
            code = os.waitstatus_to_exitcode(status)
            break
finally:
    left = adopted_children()
    if left:
        print(f"SUBREAPER_KILLED_LEFTOVERS {left}")
    kill_pids(left)
sys.exit(code)
`;

const PARENT_MODES = {
  'the subreaper, after its starter exited': 'adopted',
  'its starter, still running': 'live',
};

const STANDING_TESTS = new Set(['test_onboarder_supervisor_tick.sh', 'test_handoffd_supervisor_job_reaper.sh']);

function fixtureFile(ctx, name, body) {
  if (!ctx.bl1907Root) ctx.bl1907Root = trackedTmpRoot('sfvc-bl1907-');
  const file = path.join(ctx.bl1907Root, name);
  fs.writeFileSync(file, body);
  return file;
}

function cleanup(ctx) {
  if (ctx.bl1907Root) fs.rmSync(ctx.bl1907Root, { recursive: true, force: true });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture subreaper process$/, (ctx) => {
    ctx.bl1907Fixture = fixtureFile(ctx, 'subreaper_predicate.py', PREDICATE_FIXTURE);
  });

  scoped(/^a process below it whose parent is (.+)$/, (ctx, parent) => {
    const mode = PARENT_MODES[parent];
    assert.ok(mode, `unknown parent shape in the Examples table: ${parent}`);
    ctx.bl1907Mode = mode;
  });

  scoped(/^process_table_lib\.bb's parent-orphaned\? reads that process$/, (ctx) => {
    try {
      const res = spawnSync('python3', [ctx.bl1907Fixture, ctx.bl1907Mode, path.join(SCRIPTS_DIR, 'process_table_lib.bb')], {
        encoding: 'utf8',
        timeout: 120000,
      });
      ctx.bl1907Out = `${res.stdout || ''}${res.stderr || ''}`;
      assert.equal(res.status, 0, ctx.bl1907Out);
      const parent = /PARENT (\d+) SUBREAPER (\d+) STARTER (\d+)/.exec(ctx.bl1907Out);
      assert.ok(parent, ctx.bl1907Out);
      // The fixture really produced the parent shape the row names.
      const expected = ctx.bl1907Mode === 'adopted' ? parent[2] : parent[3];
      assert.equal(parent[1], expected, `fixture precondition: the target's parent is not ${ctx.bl1907Mode}:\n${ctx.bl1907Out}`);
      assert.notEqual(parent[1], '1', ctx.bl1907Out);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^it reads orphaned: "(yes|no)"$/, (ctx, yesNo) => {
    const m = /^ORPHANED (true|false)$/m.exec(ctx.bl1907Out);
    assert.ok(m, ctx.bl1907Out);
    assert.equal(m[1], yesNo === 'yes' ? 'true' : 'false', ctx.bl1907Out);
  });

  scoped(/^the standing shell test "([^"]+)" runs$/, (ctx, test) => {
    assert.ok(STANDING_TESTS.has(test), `unknown standing test in the Examples table: ${test}`);
    try {
      const wrapper = fixtureFile(ctx, 'subreaper_wrapper.py', TEST_WRAPPER);
      const res = spawnSync('python3', [wrapper, path.join(TEST_DIR, test)], { encoding: 'utf8', timeout: 300000 });
      ctx.bl1907Run = { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^it exits 0$/, (ctx) => {
    const { status, out } = ctx.bl1907Run;
    assert.equal(status, 0, out.split('\n').filter((l) => /FAIL|fail|die|NOT_ORPHANED|NO_SUBREAPER/.test(l)).join('\n') || out.slice(-3000));
  });
}

module.exports = { registerSteps };
