'use strict';

// BL-1639: step handlers for "Bedtime stops every babysitterd its own
// verify would count". Drives the REAL babysitterd_census_lib.sh,
// finish_shift_lib.sh (which sources it) and kill_all_swarm.sh via `bash`
// subprocess calls - the established pattern for shell-backed Gherkin
// steps in this repo (see bl762FinishShiftPhonePathSteps.js).
//
// Process signals are NEVER real here: SWARMFORGE_CENSUS_SIGNAL_RECORD_FILE
// (babysitterd_census_lib.sh's own test seam) redirects every census
// signal to a plain file instead of a real kill, so a fabricated
// (ps-snapshot-only) pid - the untracked "operator copy" and "another
// root" fixture rows - is never sent a real signal. The one exception is
// the TRACKED daemon's own row: it is a real, test-owned `sleep 300`
// process (so "the tracked pidfile is removed" is a real, observable
// filesystem effect), and stop_babysitterd's unconditional
// `signal_pid_file` call (unchanged by this ticket) really does stop it -
// safe, since it is this test's own disposable child.
//
// kill_all_swarm.sh unconditionally `exec`s into kill_pipeline_swarm.sh at
// its end - running the real file directly would perform a real,
// destructive full-stack teardown. Scenario 03 instead copies the real,
// UNMODIFIED kill_all_swarm.sh source into a scratch directory alongside
// a harmless stub kill_pipeline_swarm.sh (SCRIPT_DIR resolves to the
// scratch copy's own location, so the exec calls the stub) - the same
// "wiring test" posture bl762's own step handler documents: proving the
// call site is load-bearing, never re-executing the real pipeline killer.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const FINISH_SHIFT_LIB = path.join(SCRIPTS_DIR, 'finish_shift_lib.sh');
const CENSUS_LIB = path.join(SCRIPTS_DIR, 'babysitterd_census_lib.sh');
const KILL_ALL_SWARM = path.join(SCRIPTS_DIR, 'kill_all_swarm.sh');

function runBash(script, opts = {}) {
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (result.error) {
    throw result.error;
  }
  return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
}

function ensurePsFile(ctx) {
  if (!ctx.bl1639PsFileDir) {
    ctx.bl1639PsFileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1639-ps-'));
    ctx.bl1639PsFile = path.join(ctx.bl1639PsFileDir, 'ps.txt');
  }
  fs.writeFileSync(ctx.bl1639PsFile, `${ctx.bl1639PsLines.join('\n')}\n`);
  return ctx.bl1639PsFile;
}

function thisRootExpectedPids(ctx) {
  const pids = [];
  if (ctx.bl1639TrackedPid) pids.push(ctx.bl1639TrackedPid);
  if (ctx.bl1639ThisRootExtraPids) pids.push(...ctx.bl1639ThisRootExtraPids);
  return pids;
}

function recordedSignalledPids(ctx) {
  return fs
    .readFileSync(ctx.bl1639RecordFile, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

function assertSignalledPidsAre(ctx, expectedPids) {
  const got = [...new Set(recordedSignalledPids(ctx))].sort((a, b) => a - b);
  const expected = [...expectedPids].sort((a, b) => a - b);
  assert.deepEqual(got, expected, `expected signalled pids ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
}

function runKillAllSwarmSafely(ctx, psFile) {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1639-kas-'));
  ctx.bl1639KillAllSwarmScratch = scratchDir;
  fs.writeFileSync(path.join(scratchDir, 'kill_all_swarm.sh'), fs.readFileSync(KILL_ALL_SWARM, 'utf8'));
  fs.chmodSync(path.join(scratchDir, 'kill_all_swarm.sh'), 0o755);
  fs.copyFileSync(CENSUS_LIB, path.join(scratchDir, 'babysitterd_census_lib.sh'));
  fs.writeFileSync(
    path.join(scratchDir, 'kill_pipeline_swarm.sh'),
    '#!/usr/bin/env bash\necho STUB_PIPELINE_KILL\nexit 0\n'
  );
  fs.chmodSync(path.join(scratchDir, 'kill_pipeline_swarm.sh'), 0o755);
  const result = spawnSync('bash', [path.join(scratchDir, 'kill_all_swarm.sh'), ctx.bl1639Root], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      SWARMFORGE_SURVIVOR_PS_FILE: psFile,
      SWARMFORGE_CENSUS_SIGNAL_RECORD_FILE: ctx.bl1639RecordFile,
    },
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function cleanupFixture(ctx) {
  if (ctx.bl1639TrackedPid) {
    try {
      process.kill(ctx.bl1639TrackedPid, 'SIGKILL');
    } catch {
      /* already dead */
    }
  }
  if (ctx.bl1639Root) fs.rmSync(ctx.bl1639Root, { recursive: true, force: true });
  if (ctx.bl1639RecordDir) fs.rmSync(ctx.bl1639RecordDir, { recursive: true, force: true });
  if (ctx.bl1639PsFileDir) fs.rmSync(ctx.bl1639PsFileDir, { recursive: true, force: true });
  if (ctx.bl1639KillAllSwarmScratch) fs.rmSync(ctx.bl1639KillAllSwarmScratch, { recursive: true, force: true });
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a fixture root under a temporary directory with the finish-shift library loaded$/, (ctx) => {
    ctx.bl1639Root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1639-'));
    fs.mkdirSync(path.join(ctx.bl1639Root, '.swarmforge', 'babysitterd'), { recursive: true });
    fs.mkdirSync(path.join(ctx.bl1639Root, '.swarmforge', 'operator'), { recursive: true });
    ctx.bl1639PsLines = [];
    ctx.bl1639NextFakePid = 900001;
    ctx.bl1639ThisRootExtraPids = [];
  });

  registry.define(/^process signals are recorded through an injected seam instead of being sent$/, (ctx) => {
    ctx.bl1639RecordDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1639-record-'));
    ctx.bl1639RecordFile = path.join(ctx.bl1639RecordDir, 'signals.txt');
    fs.writeFileSync(ctx.bl1639RecordFile, '');
  });

  // ── Given: growing the process snapshot ──────────────────────────────
  registry.define(
    /^(?:the process snapshot|the snapshot) lists a(?: second)? babysitterd launched as "([^"]+)"(?: (whose pid is in the tracked pidfile|with no tracked pidfile))?$/,
    (ctx, argsTemplate, clause) => {
      const args = argsTemplate.split('<root>').join(ctx.bl1639Root);
      let pid;
      if (clause === 'whose pid is in the tracked pidfile') {
        const { stdout } = runBash('sleep 300 </dev/null >/dev/null 2>&1 & echo $!; disown -a');
        pid = parseInt(stdout.trim(), 10);
        ctx.bl1639TrackedPid = pid;
        fs.writeFileSync(path.join(ctx.bl1639Root, '.swarmforge', 'babysitterd', 'babysitterd.pid'), String(pid));
      } else {
        pid = ctx.bl1639NextFakePid;
        ctx.bl1639NextFakePid += 1;
        if (clause === 'with no tracked pidfile') {
          ctx.bl1639ThisRootExtraPids.push(pid);
        }
        // else: no clause at all — a babysitterd of another root, tracked
        // only in the raw ps snapshot, never expected in either set.
      }
      ctx.bl1639PsLines.push(`  ${pid} ${args}`);
    }
  );

  // ── When ──────────────────────────────────────────────────────────────
  registry.define(/^finish-shift stops the babysitterd component$/, (ctx) => {
    const psFile = ensurePsFile(ctx);
    const script = `
source "${FINISH_SHIFT_LIB}"
stop_ancillary_init "${ctx.bl1639Root}"
stop_babysitterd >/dev/null
`;
    runBash(script, {
      env: { SWARMFORGE_SURVIVOR_PS_FILE: psFile, SWARMFORGE_CENSUS_SIGNAL_RECORD_FILE: ctx.bl1639RecordFile },
    });
  });

  registry.define(/^kill_all_swarm runs against the fixture root$/, (ctx) => {
    ctx.bl1639IsKillAllSwarmScenario = true;
    const psFile = ensurePsFile(ctx);
    runKillAllSwarmSafely(ctx, psFile);
  });

  // ── Then ──────────────────────────────────────────────────────────────
  registry.define(
    /^(?:both pids are signalled|only the pid of this root is signalled|exactly that pid is signalled)$/,
    (ctx) => {
      assertSignalledPidsAre(ctx, thisRootExpectedPids(ctx));
      if (ctx.bl1639IsKillAllSwarmScenario) {
        cleanupFixture(ctx);
      }
    }
  );

  registry.define(
    /^the babysitterd verify census for this root names (exactly the signalled pids|only that pid)$/,
    (ctx, which) => {
      const psFile = ensurePsFile(ctx);
      const { stdout } = runBash(`source "${CENSUS_LIB}"; babysitterd_census_pids "${ctx.bl1639Root}"`, {
        env: { SWARMFORGE_SURVIVOR_PS_FILE: psFile },
      });
      const got = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .sort((a, b) => a - b);
      const expected = thisRootExpectedPids(ctx).sort((a, b) => a - b);
      assert.deepEqual(got, expected, `expected census ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
      if (which === 'only that pid') {
        cleanupFixture(ctx);
      }
    }
  );

  registry.define(/^the tracked pidfile is removed$/, (ctx) => {
    const pidFile = path.join(ctx.bl1639Root, '.swarmforge', 'babysitterd', 'babysitterd.pid');
    try {
      assert.equal(fs.existsSync(pidFile), false, `expected ${pidFile} to be removed`);
    } finally {
      cleanupFixture(ctx);
    }
  });
}

module.exports = { registerSteps };
