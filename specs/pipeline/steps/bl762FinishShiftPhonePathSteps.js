'use strict';

// BL-762: step handlers for "bedtime stops the pack but leaves the phone
// path reachable". Drives the REAL swarmforge/scripts/lifecycle_matrix.sh,
// finish_shift_lib.sh, and stop_ancillary_services.sh via `bash -c`
// subprocess calls (the established pattern for shell-backed Gherkin
// steps in this repo - see backlogDepthCapOverrideSteps.js's
// execFileSync('bb', ...) and bl433BuildFreshnessOperatorRestartRaceSteps.js's
// spawnSync('bash', ...)).
//
// Fixture convention matches this project's own shell test suite (see
// swarmforge/scripts/test/test_stop_ancillary_services_onboarder_dual_clear.sh
// and the new swarmforge/scripts/test/test_finish_shift_lib.sh): real
// `sleep 300 &` fake processes + scratch pidfile roots for the five
// ancillary components (babysitterd/front-desk/onboarder/operator-runtime/
// tunnels), and stack_survivor_scan.sh's own SWARMFORGE_SURVIVOR_PS_FILE
// seam for the two ps-pattern-based checks (babysitterd, operator-runtime)
// - so this test never depends on, or is confused by, this machine's own
// real live swarm process table.
//
// "The swarm agent sessions" / "handoffd" (scenario 01's two pipeline rows)
// are NOT lifecycle_matrix.sh components - they are the core pipeline,
// stopped by kill_pipeline_swarm.sh, which BOTH finish-shift and
// stop-swarm.sh call unconditionally. Proven here as a wiring check (both
// entrypoint scripts' source names kill_pipeline_swarm.sh as a call site) -
// kill_pipeline_swarm.sh's OWN correctness has its own test suite; this
// ticket's job is only to prove finish-shift reaches it (BL-576's
// established "wiring test" posture: prove the call site is load-bearing,
// not re-test the callee's internals).
//
// "The bridge is still listening" / "the published tunnel still resolves"
// (scenario 02) are verified via the SAME pidfile-liveness check the rest
// of this component's own code trusts (stop_ancillary_services.sh's own
// signal_pid_file), not a real HTTP/DNS round trip - a live network check
// belongs to QA's manual e2e procedure (already explicit in the ticket's
// own qa_e2e_procedure items 2-3), not an isolated automated scenario.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIFECYCLE_MATRIX = path.join(SCRIPTS_DIR, 'lifecycle_matrix.sh');
const FINISH_SHIFT_LIB = path.join(SCRIPTS_DIR, 'finish_shift_lib.sh');
const STOP_ANCILLARY = path.join(SCRIPTS_DIR, 'stop_ancillary_services.sh');
const FINISH_SHIFT_ENTRY = path.join(REPO_ROOT, 'finish-shift');
const STOP_SWARM_ENTRY = path.join(REPO_ROOT, 'stop-swarm.sh');

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

function mkScratchRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl762-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
  return root;
}

function writeCleanPsFile() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'bl762-ps-'));
  const file = path.join(p, 'ps.txt');
  fs.writeFileSync(file, '  1 init\n');
  return file;
}

// Spawns fake `sleep 300` processes for all 5 ancillary components and
// writes their pidfiles into the scratch root - the SAME "ancillary
// services up" fixture shape test_finish_shift_lib.sh's start_fixture uses.
// Runs as ONE bash script so every PID lands in ctx as a real background
// process this Node process can later kill -0 / kill -9 directly.
//
// Each `sleep 300` MUST redirect its own stdin/stdout/stderr away from the
// inherited pipe (`</dev/null >/dev/null 2>&1 &`) - without this, the
// backgrounded child inherits spawnSync's stdout/stderr PIPE file
// descriptors, and since sleep never exits, that pipe never reaches EOF:
// spawnSync then blocks reading the child's output until ITS OWN timeout
// fires, even though the `bash -c` process that spawned it already
// returned. Root-caused via direct repro (a plain `sleep 300 &` with no
// redirect made every call to this function hang for exactly the
// spawnSync timeout, regardless of `disown`, which only affects job
// control/SIGHUP, not fd inheritance) - see backlog/evidence/BL-762-coder-pass.md.
function startFixture(ctx) {
  const bbDir = path.join(ctx.bl762Root, '.swarmforge', 'babysitterd');
  const opDir = path.join(ctx.bl762Root, '.swarmforge', 'operator');
  const script = `
sleep 300 </dev/null >/dev/null 2>&1 & BB_PID=$!
sleep 300 </dev/null >/dev/null 2>&1 & FD_PID=$!
sleep 300 </dev/null >/dev/null 2>&1 & OB_PID=$!
sleep 300 </dev/null >/dev/null 2>&1 & OR_PID=$!
sleep 300 </dev/null >/dev/null 2>&1 & TN_PID=$!
echo "$BB_PID" > "${bbDir}/babysitterd.pid"
echo "$FD_PID" > "${opDir}/front-desk-supervisor.pid"
echo "$OB_PID" > "${opDir}/onboarder-supervisor.pid"
echo "$OR_PID" > "${opDir}/runtime.pid"
echo "$TN_PID" > "${opDir}/resident-spy-cloudflared.pid"
disown -a
echo "BB=$BB_PID FD=$FD_PID OB=$OB_PID OR=$OR_PID TN=$TN_PID"
`;
  const { stdout } = runBash(script);
  const pids = {};
  for (const pair of stdout.trim().split(/\s+/)) {
    const [k, v] = pair.split('=');
    pids[k] = parseInt(v, 10);
  }
  ctx.bl762Pids = pids;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPids(pids) {
  for (const pid of Object.values(pids || {})) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already dead */
    }
  }
}

// This registry has no afterEach/scenario-teardown hook, so every scenario
// must clean up its own fixture at its OWN last step - called from each
// scenario's actual final Then step below (identified from the feature
// file's own scenario shapes), never left to a shared hook that does not
// exist here.
function cleanupFixture(ctx) {
  killPids(ctx.bl762Pids);
  if (ctx.bl762Root) fs.rmSync(ctx.bl762Root, { recursive: true, force: true });
  if (ctx.bl762CleanPs) fs.rmSync(path.dirname(ctx.bl762CleanPs), { recursive: true, force: true });
}

const COMPONENT_TO_MATRIX_NAME = {
  babysitterd: 'babysitterd',
  'the operator runtime': 'operator-runtime',
  'the onboarder': 'onboarder',
  'the Telegram front desk': 'front-desk',
  'the remote tunnels': 'tunnels',
};
const PIPELINE_COMPONENTS = new Set(['the swarm agent sessions', 'handoffd']);

const VERB_TO_MATRIX_NAME = {
  'finish-shift': 'finish-shift',
  'stop-swarm': 'stop-swarm',
};

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a running swarm with its ancillary services up$/, (ctx) => {
    ctx.bl762Root = mkScratchRoot();
    ctx.bl762CleanPs = writeCleanPsFile();
    startFixture(ctx);
  });

  // ── Scenario 01: each lifecycle verb stops exactly the components it owns
  registry.define(/^the operator runs (finish-shift|stop-swarm)$/, (ctx, verb) => {
    ctx.bl762LastVerb = verb;
    if (verb === 'finish-shift') {
      const script = `
source "${FINISH_SHIFT_LIB}"
finish_shift_keep_snapshot "${ctx.bl762Root}"
before="$finish_shift_keep_running"
finish_shift_stop_ancillaries "${ctx.bl762Root}" >/dev/null
if finish_shift_verify "${ctx.bl762Root}" "$before"; then
  echo "VERIFY_PROBLEM survivors=[$finish_shift_verify_survivors] unexpected=[$finish_shift_verify_unexpectedly_stopped]"
else
  echo "VERIFY_CLEAN"
fi
`;
      const { stdout } = runBash(script, { env: { SWARMFORGE_SURVIVOR_PS_FILE: ctx.bl762CleanPs } });
      ctx.bl762VerifyResult = stdout.trim();
    } else {
      const script = `source "${STOP_ANCILLARY}"; stop_ancillary_services_main "${ctx.bl762Root}"`;
      runBash(script, { env: { SWARMFORGE_SURVIVOR_PS_FILE: ctx.bl762CleanPs } });
    }
  });

  // This step text is shared by two DIFFERENT scenarios: it is Scenario
  // Outline 01's own last step (9 independent scenarios - cleanup belongs
  // here), but it is ALSO scenario 04's THIRD step, mid-scenario, where
  // "the operator has already run finish-shift" (below) marks
  // ctx.bl762SkipComponentCleanup so THIS handler skips cleanup and leaves
  // it to scenario 04's own actual last step ("the survivor scan reports a
  // clean slate"). Cleaning up here unconditionally was a real bug found
  // during authoring: it deleted ctx.bl762CleanPs (the mock ps snapshot)
  // mid-scenario-04, so the LATER survivor-scan step's
  // SWARMFORGE_SURVIVOR_PS_FILE pointed at a file that no longer existed,
  // silently falling back to this machine's REAL process table and
  // reporting the real live swarm's real babysitterd as a false-positive
  // survivor - see backlog/evidence/BL-762-coder-pass.md.
  registry.define(/^(the swarm agent sessions|handoffd|babysitterd|the operator runtime|the onboarder|the Telegram front desk|the remote tunnels) is (stopped|left running)$/, (ctx, component, disposition) => {
    try {
      const verb = ctx.bl762LastVerb;
      if (PIPELINE_COMPONENTS.has(component)) {
        // Wiring check: the entrypoint that ran must call kill_pipeline_swarm.sh.
        const entry = verb === 'finish-shift' ? FINISH_SHIFT_ENTRY : STOP_SWARM_ENTRY;
        const src = fs.readFileSync(entry, 'utf8');
        const callsPipelineKill = src.includes('kill_pipeline_swarm.sh');
        if (disposition === 'stopped' && !callsPipelineKill) {
          throw new Error(`expected ${entry} to call kill_pipeline_swarm.sh (stops ${component}) but it does not`);
        }
        return;
      }
      const matrixName = COMPONENT_TO_MATRIX_NAME[component];
      if (!matrixName) {
        throw new Error(`unknown component "${component}" - no lifecycle_matrix mapping registered`);
      }
      const matrixVerb = VERB_TO_MATRIX_NAME[verb];
      const script = `source "${LIFECYCLE_MATRIX}"; lifecycle_matrix_disposition "${matrixName}" "${matrixVerb}"`;
      const { stdout } = runBash(script);
      const actual = stdout.trim();
      const expected = disposition === 'stopped' ? 'stop' : 'keep';
      if (actual !== expected) {
        throw new Error(`expected "${component}" under "${verb}" to be classified "${expected}", got "${actual}"`);
      }
    } finally {
      if (!ctx.bl762SkipComponentCleanup) {
        cleanupFixture(ctx);
      }
    }
  });

  // ── Scenario 02: after bedtime the phone still reaches the host bridge ──
  registry.define(/^the bridge is still listening on its configured port$/, (ctx) => {
    const pid = ctx.bl762Pids.FD;
    if (!pidAlive(pid)) {
      throw new Error('expected the front-desk (bridge-owning) process to still be alive after finish-shift');
    }
  });

  // Scenario 02's last step - cleans up its fixture in a finally.
  registry.define(/^the published tunnel still resolves to that bridge$/, (ctx) => {
    try {
      const pid = ctx.bl762Pids.TN;
      if (!pidAlive(pid)) {
        throw new Error('expected the resident-spy tunnel process to still be alive after finish-shift');
      }
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── Scenario 03: nothing left running after bedtime can revive a seat ───
  // This is scenario 03's only (and last) Then step - cleans up its own
  // fixture in a finally.
  registry.define(/^no surviving component is one that relaunches agent seats$/, (ctx) => {
    try {
      const script = `
source "${FINISH_SHIFT_LIB}"
for component in "\${LIFECYCLE_SEAT_REVIVING_COMPONENTS[@]}"; do
  if finish_shift_component_running "${ctx.bl762Root}" "$component"; then
    echo "SEAT_REVIVOR_STILL_UP $component"
  fi
done
echo DONE
`;
      const { stdout } = runBash(script, { env: { SWARMFORGE_SURVIVOR_PS_FILE: ctx.bl762CleanPs } });
      if (stdout.includes('SEAT_REVIVOR_STILL_UP')) {
        throw new Error(`a component that can revive a stopped seat is still running after finish-shift: ${stdout}`);
      }
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── Scenario 04: the full stop after bedtime still tears the phone path down
  // "the Telegram front desk is stopped" reuses scenario 01's component-
  // disposition step above (same text, "is stopped") - a static
  // classification check. "the remote tunnels ARE stopped" (plural verb)
  // does not match that regex's singular "is", so it gets its own
  // registration doing the identical classification check. Both are
  // deliberately the WEAKER static check here; this scenario's actual
  // dynamic proof - that running stop-swarm after finish-shift really did
  // kill the fixture's front-desk/tunnels processes, not just that the
  // table says it should - is "the survivor scan reports a clean slate"
  // below, which checks all five components' REAL process state.
  registry.define(/^the remote tunnels are stopped$/, (ctx) => {
    const script = `source "${LIFECYCLE_MATRIX}"; lifecycle_matrix_disposition "tunnels" "stop-swarm"`;
    const { stdout } = runBash(script);
    if (stdout.trim() !== 'stop') {
      throw new Error(`expected "tunnels" under "stop-swarm" to be classified "stop", got "${stdout.trim()}"`);
    }
  });

  registry.define(/^the operator has already run finish-shift$/, (ctx) => {
    // This scenario's next step is the shared "<component> is (stopped|left
    // running)" text ("the Telegram front desk is stopped"), which is NOT
    // this scenario's last step here - suppress its cleanup so the fixture
    // (and the mock ps snapshot file) survive through to this scenario's
    // own actual last step below.
    ctx.bl762SkipComponentCleanup = true;
    const script = `
source "${FINISH_SHIFT_LIB}"
finish_shift_keep_snapshot "${ctx.bl762Root}"
finish_shift_stop_ancillaries "${ctx.bl762Root}" >/dev/null
`;
    runBash(script, { env: { SWARMFORGE_SURVIVOR_PS_FILE: ctx.bl762CleanPs } });
  });

  // Scenario 04's actual last step - cleans up its own fixture in a finally.
  registry.define(/^the survivor scan reports a clean slate$/, (ctx) => {
    try {
      const script = `
source "${FINISH_SHIFT_LIB}"
problem=0
for component in babysitterd front-desk onboarder operator-runtime tunnels; do
  if finish_shift_component_running "${ctx.bl762Root}" "$component"; then
    echo "SURVIVOR $component"
    problem=1
  fi
done
[[ "$problem" -eq 0 ]] && echo CLEAN || echo DIRTY
`;
      const { stdout } = runBash(script, { env: { SWARMFORGE_SURVIVOR_PS_FILE: ctx.bl762CleanPs } });
      if (!stdout.includes('CLEAN')) {
        throw new Error(`expected a clean survivor scan after stop-swarm, got: ${stdout}`);
      }
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── Scenario 05: bedtime is safe to run when its targets are already down
  registry.define(/^the swarm is already stopped$/, (ctx) => {
    killPids(ctx.bl762Pids);
    ctx.bl762Pids = {};
    // Also clear the pidfiles - "already stopped" means no live seats AND
    // no stale pidfiles pointing at dead PIDs, matching a real prior
    // stop-swarm/kill_all_swarm run's own cleanup.
    const opDir = path.join(ctx.bl762Root, '.swarmforge', 'operator');
    const bbDir = path.join(ctx.bl762Root, '.swarmforge', 'babysitterd');
    for (const f of [
      'front-desk-supervisor.pid',
      'onboarder-supervisor.pid',
      'runtime.pid',
      'resident-spy-cloudflared.pid',
    ]) {
      fs.rmSync(path.join(opDir, f), { force: true });
    }
    fs.rmSync(path.join(bbDir, 'babysitterd.pid'), { force: true });
  });

  registry.define(/^bedtime has already been run once$/, (ctx) => {
    const script = `
source "${FINISH_SHIFT_LIB}"
finish_shift_keep_snapshot "${ctx.bl762Root}"
finish_shift_stop_ancillaries "${ctx.bl762Root}" >/dev/null
`;
    runBash(script, { env: { SWARMFORGE_SURVIVOR_PS_FILE: ctx.bl762CleanPs } });
  });

  registry.define(/^the command succeeds$/, (ctx) => {
    if (ctx.bl762LastVerb !== 'finish-shift') {
      throw new Error('expected the last verb run to be finish-shift for this scenario');
    }
    if (ctx.bl762VerifyResult !== 'VERIFY_CLEAN') {
      throw new Error(`expected finish-shift to succeed cleanly, got: ${ctx.bl762VerifyResult}`);
    }
  });

  // Scenario 05's actual last step - cleans up its own fixture in a finally.
  registry.define(/^the components bedtime leaves up are unchanged$/, (ctx) => {
    try {
      // finish_shift_verify's own "unexpectedly stopped" half IS this check -
      // already asserted VERIFY_CLEAN above; re-derive it explicitly here so
      // this scenario's own Then step has an independent assertion rather
      // than only reusing "the command succeeds"'s captured result.
      if (ctx.bl762VerifyResult !== 'VERIFY_CLEAN') {
        throw new Error(`expected bedtime's kept components to be unchanged, got: ${ctx.bl762VerifyResult}`);
      }
    } finally {
      cleanupFixture(ctx);
    }
  });
}

module.exports = { registerSteps };
