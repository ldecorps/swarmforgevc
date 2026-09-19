'use strict';

// BL-1649: step handlers for "The claim-idle ladder reads a per-role
// timeout, logs every reclaim, and never counts a dead agent as idle".
// Scenarios 01-05 drive the REAL claim_progress_lib.bb/chase_sweep_lib.bb
// functions directly via a `bb -e` subprocess (evaluate-claim-idle-signal
// is pure - no fixture root needed beyond a conf-text string). Scenario 06
// drives the REAL daemon-sweep test harness
// (test/chase_sweep_test_runner.bb - the SAME "calls.log stands in for
// handoffd.log" convention test_claim_progress_sweep.sh's own wiring test
// already establishes) against a real fixture root under mkdtemp
// (BL-1390).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE =
  'BL-1649 The claim-idle ladder reads a per-role timeout, logs every reclaim, and never counts a dead agent as idle';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CLAIM_LIB = path.join(SCRIPTS_DIR, 'claim_progress_lib.bb');
const CHASE_LIB = path.join(SCRIPTS_DIR, 'chase_sweep_lib.bb');
const CHASE_TEST_RUNNER = path.join(SCRIPTS_DIR, 'test', 'chase_sweep_test_runner.bb');

const CLAIM_COMMIT = 'aaaa000000';
const NOW_MS = 2000000000000;

function runBb(script) {
  const result = spawnSync('bb', ['-e', script], { encoding: 'utf8', timeout: 15000 });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`bb -e failed (status ${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function evaluateClaimIdleSignal({ confText, role, ageMinutes, agentPresent, respawnedRecently, reclaims }) {
  const claimAtMs = NOW_MS - ageMinutes * 60000;
  const ctxEntries = [
    ['role', JSON.stringify(role)],
    ['agent-busy?', 'false'],
    ['worktree-dirty?', 'false'],
    ['resident-busy?', 'false'],
    ['resident-recently-active?', 'false'],
  ];
  if (agentPresent !== null && agentPresent !== undefined) ctxEntries.push(['agent-present?', String(agentPresent)]);
  if (respawnedRecently !== null && respawnedRecently !== undefined)
    ctxEntries.push(['respawned-recently?', String(respawnedRecently)]);
  const ctxClj = `{${ctxEntries.map(([k, v]) => `:${k} ${v}`).join(' ')}}`;
  const script = `
(load-file "${CLAIM_LIB}")
(load-file "${CHASE_LIB}")
(let [conf-text ${JSON.stringify(confText)}
      role-map (merge (:role-idle-timeout-ms claim-progress-lib/default-config)
                       (chase-sweep-lib/parse-claim-idle-timeout-role-minutes-ms conf-text))
      cfg {:role-idle-timeout-ms role-map :probe-grace-ms 0}
      progress {:claimCommit "${CLAIM_COMMIT}" :claimAtMs ${claimAtMs} :reclaims ${reclaims || 0}
                :idleProbeAtMs ${claimAtMs}}
      ctx ${ctxClj}]
  (println (name (claim-progress-lib/evaluate-claim-idle-signal progress "${CLAIM_COMMIT}" ${NOW_MS} cfg ctx))))
`;
  return runBb(script);
}

function ensureState(ctx) {
  if (!ctx.bl1649) {
    ctx.bl1649 = { confText: '', role: 'QA', ageMinutes: 45, agentPresent: null, respawnedRecently: null };
  }
  return ctx.bl1649;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(
    /^a fixture root with a daemon-shaped \.swarmforge, a swarmforge\.conf, and a QA claim sidecar whose commit HEAD has not moved past$/,
    (ctx) => {
      ensureState(ctx);
    }
  );

  // ── Given ─────────────────────────────────────────────────────────────
  scoped(/^swarmforge\.conf sets claim_idle_timeout_role_minutes (\S+) (-?\S+)$/, (ctx, role, value) => {
    ensureState(ctx).confText = `config claim_idle_timeout_role_minutes ${role} ${value}\n`;
  });

  scoped(/^swarmforge\.conf sets no claim_idle_timeout_role_minutes line$/, (ctx) => {
    ensureState(ctx).confText = '';
  });

  scoped(/^a (\S+) claim (\d+) minutes old with no busy footer and a clean worktree$/, (ctx, role, ageMin) => {
    const state = ensureState(ctx);
    state.role = role;
    state.ageMinutes = parseInt(ageMin, 10);
  });

  scoped(
    /^a (\S+) claim (\d+) minutes old with no busy footer, a clean worktree and a present agent$/,
    (ctx, role, ageMin) => {
      const state = ensureState(ctx);
      state.role = role;
      state.ageMinutes = parseInt(ageMin, 10);
      state.agentPresent = true;
    }
  );

  scoped(/^the (\S+) agent process is absent under a live pane$/, (ctx, role) => {
    const state = ensureState(ctx);
    state.role = role;
    state.agentPresent = false;
  });

  scoped(/^the (\S+) agent was respawned by the chase sweep 60 seconds ago$/, (ctx, role) => {
    const state = ensureState(ctx);
    state.role = role;
    state.respawnedRecently = true;
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(/^the claim-idle signal is evaluated for (\S+)$/, (ctx, role) => {
    const state = ensureState(ctx);
    state.role = role;
    state.outcome = evaluateClaimIdleSignal(state);
  });

  scoped(/^the daemon's claim-progress sweep runs once on the fixture root$/, (ctx) => {
    const state = ensureState(ctx);
    const root = mkProcessTmpDir('bl1649acc-');
    state.sweepRoot = root;
    const inProcess = path.join(root, 'inbox', 'in_process');
    fs.mkdirSync(inProcess, { recursive: true });
    fs.mkdirSync(path.join(root, 'inbox', 'new'), { recursive: true });
    fs.mkdirSync(path.join(root, 'inbox', 'completed'), { recursive: true });
    fs.mkdirSync(path.join(root, 'inbox', 'abandoned'), { recursive: true });
    fs.writeFileSync(
      path.join(inProcess, 'test.handoff'),
      `id: test\nfrom: coordinator\nto: ${state.role}\npriority: 10\ntype: git_handoff\ntask: BL-528-test\ncommit: ${CLAIM_COMMIT}\ndequeued_at: 2026-07-19T22:00:00Z\n`
    );
    const claimAtMs = 0;
    fs.writeFileSync(
      path.join(inProcess, 'test.handoff.claim-progress.json'),
      JSON.stringify({ claimCommit: CLAIM_COMMIT, claimAtMs, reclaims: 0, idleProbeAtMs: claimAtMs })
    );
    const nowMs = state.ageMinutes * 60000;
    const result = spawnSync(
      'bb',
      [CHASE_TEST_RUNNER, root, String(nowMs), 'alive', String(nowMs), state.role],
      {
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          CLAIM_IDLE_TIMEOUT_MS: '1000',
          CLAIM_PROBE_GRACE_MS: '0',
          CLAIM_HEAD_COMMIT: CLAIM_COMMIT,
          CLAIM_ROLE_TIMEOUT_CONF_TEXT: state.confText,
          CLAIM_AGENT_PRESENT: '1',
        },
      }
    );
    if (result.error) throw result.error;
    state.callsLog = fs.readFileSync(path.join(root, 'calls.log'), 'utf8');
  });

  // ── Then ──────────────────────────────────────────────────────────────
  scoped(/^the outcome is (not-yet-overdue|claimed-idle|paused-agent-absent)$/, (ctx, expected) => {
    const state = ensureState(ctx);
    assert.equal(state.outcome, expected, `expected outcome ${expected}, got ${state.outcome}`);
  });

  scoped(/^the reclaim count is unchanged$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.outcome, 'paused-agent-absent', 'expected the paused-agent-absent branch, which never increments');
  });

  scoped(/^the reclaim count becomes 1$/, (ctx) => {
    const state = ensureState(ctx);
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(state.sweepRoot, 'inbox', 'in_process', 'test.handoff.claim-progress.json'), 'utf8')
    );
    assert.equal(sidecar.reclaims, 1, `expected reclaims=1, got ${JSON.stringify(sidecar)}`);
  });

  scoped(
    /^the daemon log carries exactly one claim-idle-reclaim line naming QA, the count 1, the busy, dirty, recent and present readings, and the elapsed and timeout minutes$/,
    (ctx) => {
      const state = ensureState(ctx);
      const lines = state.callsLog.split('\n').filter((l) => l.startsWith('claim-idle-reclaim'));
      assert.equal(lines.length, 1, `expected exactly one claim-idle-reclaim line, got: ${state.callsLog}`);
      assert.match(
        lines[0],
        /^claim-idle-reclaim QA reclaims=1 busy=false dirty=false recent=false present=true elapsed-min=\d+ timeout-min=\d+$/,
        `unexpected log line shape: ${lines[0]}`
      );
    }
  );
}

module.exports = { registerSteps };
