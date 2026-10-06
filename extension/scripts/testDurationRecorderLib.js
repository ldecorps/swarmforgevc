// BL-078: pure logic for the test-suite duration recorder lives here so
// recordTestDuration.js (the CLI entry point that shells out to the real
// test run) stays a thin wrapper — mirrors crapLib.js's split.
const fs = require('fs');
const path = require('path');

function listTestFiles(testDir) {
  return fs
    .readdirSync(testDir)
    .filter((f) => f.endsWith('.test.js'))
    .sort();
}

// BL-2041: specs/pipeline/test's own *.test.js files, found recursively
// (listTestFiles above is one level deep, this directory's files nest under
// steps/) - fixtures/ is excluded (it holds fixture data, never a test file
// of its own; excluded by directory name rather than assumed empty, so a
// fixture that someday grows a same-suffix file still never joins the run).
// Absolute paths, sorted, so recordTestDuration.js's node --test invocation
// is explicit about exactly what ran rather than trusting a shell glob that
// could silently expand to nothing.
function listPipelineTestFiles(testDir) {
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'fixtures') continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
        out.push(path.join(dir, entry.name));
      }
    }
  }
  walk(testDir);
  return out.sort();
}

// BL-1598: pole_ms/work_ms/new_offenders/budget_verdict come from the
// per-file budget guard's own run against this same report (see
// check-suite-file-budget.js's runGuardAgainstReport) - result stays the
// TEST outcome (pass/fail of the tests themselves), independent of
// budget_verdict, so a trend reader can tell a failing test from a slow
// file. watch_files (amended 2026-09-16) is the count of unregistered
// files over budget but under NEW_POLE_REFUSAL_FRACTION - reported on
// every run they occur, never refusing.
// BL-1599: work_budget_verdict (the work ratchet's own 'ok' | 'over-tolerance'
// | 'over-budget') rides beside BL-1598's budget_verdict (the per-file
// guard's), independent of it - see check-suite-duration-budget.ts's
// classifySuiteWork.
// BL-1983: loadAvg5/cores carry the 5-minute load average and logical core
// count the run's work total was measured at, on every record - so a
// later reader can tell an inflated-by-load number from a genuine
// regression without re-running anything.
function buildRecord({ finishedAt, testCount, exitCode, durationMs, poleMs, workMs, newOffenders, watchFiles, budgetVerdict, workBudgetVerdict, loadAvg5, cores }) {
  return {
    finished_at: finishedAt,
    test_count: testCount,
    result: exitCode === 0 ? 'pass' : 'fail',
    duration_ms: durationMs,
    pole_ms: poleMs,
    work_ms: workMs,
    new_offenders: newOffenders,
    watch_files: watchFiles,
    budget_verdict: budgetVerdict,
    work_budget_verdict: workBudgetVerdict,
    load_avg_5m: loadAvg5,
    cores: cores,
  };
}

// Recording must never break the suite (BL-078 suite-duration-02): any
// write failure (unwritable path, full disk, missing directory, ...) is
// swallowed and reported back as false rather than thrown.
function appendRecord(logPath, record) {
  try {
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
    return true;
  } catch {
    return false;
  }
}

// BL-378: a real test failure always wins over the file-budget guard's own
// exit code (the more urgent signal), so the guard can never mask a
// genuine test failure by exiting 0. Pulled out of recordTestDuration.js's
// main() so this decision is covered in-process rather than only by the
// script's own untested subprocess orchestration.
// BL-1599: workExitCode is a THIRD source, same precedence (a real test
// failure wins over either budget-refusing source) - defaulted to 0 so
// every pre-BL-1599 2-arg call site keeps its exact prior behavior.
function computeFinalExitCode(testExitCode, guardExitCode, workExitCode = 0) {
  if (testExitCode !== 0) return testExitCode;
  return guardExitCode !== 0 ? guardExitCode : workExitCode;
}

// ── BL-1910: a confirmation leaves no process behind ─────────────────────
// recordTestDuration.js's confirmPoleAlone measures a file alone with a
// nested vitest run under a timeout. spawnSync's own timeout signals only
// the process it started, so vitest's forked workers were orphaned and kept
// running (on a loaded host, each one pushes more files over the line, and
// their confirmations time out in turn). The confirmation now runs vitest
// through this file, invoked as a script with RUN_IN_OWN_GROUP_FLAG. That
// starts the command as the leader of its own process group, signals the
// whole group on timeout (TERM, then KILL after a grace), and, however the
// leader ends, returns only once the group is empty. It lives here, not in
// a file of its own, because every sandbox that copies the recorder copies
// this lib beside it (bl1761's fixture, a Stryker sandbox).

const RUN_IN_OWN_GROUP_FLAG = '--run-in-own-group';
// coreutils timeout(1)'s code, and one more for a signal the runner did not send.
const GROUP_TIMEOUT_EXIT = 124;
const GROUP_SIGNALLED_EXIT = 125;

// Pure: the runner's exit code. A timeout wins over whatever the killed
// leader then reported.
function groupRunExitCode({ timedOut, code, signal }) {
  if (timedOut) return GROUP_TIMEOUT_EXIT;
  if (code !== null && code !== undefined) return code;
  return signal ? GROUP_SIGNALLED_EXIT : 1;
}

// Pure: the {failed} reason a spawnSync result of the runner stands for, or
// null when the command itself finished (its report is read as before).
function groupRunFailure({ status, signal }, timeoutMs) {
  if (signal) return `confirmation runner killed by signal ${signal}`;
  if (status === GROUP_TIMEOUT_EXIT) return `confirmation timed out after ${timeoutMs}ms; its process group was killed`;
  if (status === GROUP_SIGNALLED_EXIT) return 'confirmation killed by a signal it did not send';
  return null;
}

function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function signalGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch {
    /* already empty */
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Until the group is empty: give it the grace to exit on its own, then
// TERM, then KILL, then wait (bounded) for the kernel and the adopter to
// clear it.
async function drainGroup(pgid, graceMs) {
  const deadline = (ms) => Date.now() + ms;
  for (const [signal, wait] of [[null, graceMs], ['SIGTERM', graceMs], ['SIGKILL', 5000]]) {
    if (signal) signalGroup(pgid, signal);
    const until = deadline(wait);
    while (groupAlive(pgid) && Date.now() < until) await sleep(25);
    if (!groupAlive(pgid)) return;
  }
}

// The runner: argv is [timeoutMs, graceMs, cmd, ...args]. Exits with
// groupRunExitCode once the group is empty.
function runInOwnProcessGroup(argv) {
  const { spawn } = require('child_process');
  const [timeoutText, graceText, cmd, ...args] = argv;
  const timeoutMs = Number(timeoutText);
  const graceMs = Number(graceText);
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    signalGroup(child.pid, 'SIGTERM');
    setTimeout(() => signalGroup(child.pid, 'SIGKILL'), graceMs).unref();
  }, timeoutMs);
  child.on('error', (err) => {
    process.stderr.write(`run-in-own-group: ${err.message}\n`);
    process.exit(127);
  });
  child.on('exit', async (code, signal) => {
    clearTimeout(timer);
    await drainGroup(child.pid, timedOut ? 0 : graceMs);
    process.exit(groupRunExitCode({ timedOut, code, signal }));
  });
}

if (require.main === module && process.argv[2] === RUN_IN_OWN_GROUP_FLAG) {
  runInOwnProcessGroup(process.argv.slice(3));
}

module.exports = {
  listTestFiles,
  listPipelineTestFiles,
  buildRecord,
  appendRecord,
  computeFinalExitCode,
  RUN_IN_OWN_GROUP_FLAG,
  GROUP_TIMEOUT_EXIT,
  GROUP_SIGNALLED_EXIT,
  groupRunExitCode,
  groupRunFailure,
};
