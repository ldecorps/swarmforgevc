'use strict';

// BL-1505: step handlers for "A dedup-suppressed chase still counts toward
// respawn and dead-letter". Three execution strategies, matched to what
// each scenario actually needs (same split bl870WakeAttributionSteps.js
// uses for the sibling BL-870 feature):
//
// - Scenario 01 is the standing wiring proof itself: runs the REAL
//   swarmforge/scripts/test/test_handoffd_wake_attribution_wiring.sh
//   unmodified (bl943FixtureCleanupVerdictSteps.js's own idiom - spawnSync,
//   never a captured backgrounded daemon) and asserts it exits 0 with case
//   05 among its PASS lines.
//
// - Scenario 02 drives the REAL handoffd.bb daemon end to end against a
//   disposable fixture root with a fake idle tmux on PATH (bl870's own
//   runDaemon idiom), but PRE-SEEDS wake_dedup_lib.bb's per-role sidecar
//   with the mailbox's own fingerprint and an old lastInjectedAtMs (outside
//   the cooldown window) - so the very first chase sweep is guaranteed
//   dedup-suppressed as unchanged-mailbox, rather than depending on the
//   delivery-wake/chase-wake timing race the standing test's own case 05
//   happens to hit.
//
// - Scenario 03 is a pure call, no daemon: chase_sweep_lib.bb's own
//   run-sweep! driven twice - once with every :send-wake-up! call
//   {:attempted true :landed true}, once with every call {:attempted true
//   :landed false} - to reach the SAME chaseCount (maxChases) two
//   different ways, then decide-stale-item-action is called directly
//   against each resulting count and the two verdicts are compared.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const TEST_SCRIPTS_DIR = path.join(SCRIPTS, 'test');
const HANDOFFD = path.join(SCRIPTS, 'handoffd.bb');
const CHASE = path.join(SCRIPTS, 'chase_sweep_lib.bb');

const FEATURE = 'BL-1505 A dedup-suppressed chase still counts toward respawn and dead-letter';

function ensureState(ctx) {
  if (!ctx.bl1505) ctx.bl1505 = {};
  return ctx.bl1505;
}

// ── Scenario 01 ──────────────────────────────────────────────────────────

function registerScenario01(registry) {
  registry.defineScoped(
    /^swarmforge\/scripts\/test\/test_handoffd_wake_attribution_wiring\.sh runs against the real daemon$/,
    (ctx) => {
      const st = ensureState(ctx);
      const scriptPath = path.join(TEST_SCRIPTS_DIR, 'test_handoffd_wake_attribution_wiring.sh');
      const result = spawnSync('bash', [scriptPath], { encoding: 'utf8', env: process.env });
      st.result = { exitCode: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
    },
    FEATURE
  );

  registry.defineScoped(
    /^every case passes, case 05 among them$/,
    (ctx) => {
      const st = ensureState(ctx);
      assert.equal(
        st.result.exitCode,
        0,
        `expected exit 0, got ${st.result.exitCode}. stdout:\n${st.result.stdout}\nstderr:\n${st.result.stderr}`
      );
      assert.match(
        st.result.stdout,
        /PASS: 05:/,
        `expected a case 05 PASS line, got stdout:\n${st.result.stdout}`
      );
      assert.match(st.result.stdout, /ALL PASS/, `expected the run to reach its end, got stdout:\n${st.result.stdout}`);
    },
    FEATURE
  );
}

// ── Scenario 02 ──────────────────────────────────────────────────────────

// Mirrors wake_dedup_lib.bb's mailbox-fingerprint exactly: sha256 hex of
// the sorted *.handoff basenames in inbox/new + inbox/in_process, joined by
// "\n" (empty string when both are empty - not exercised here, the fixture
// always plants one).
function mailboxFingerprint(root) {
  const names = [];
  for (const dirKind of ['new', 'in_process']) {
    const dir = path.join(root, '.swarmforge', 'handoffs', 'inbox', dirKind);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.handoff')) names.push(name);
    }
  }
  names.sort();
  if (names.length === 0) return '';
  return crypto.createHash('sha256').update(names.join('\n'), 'utf8').digest('hex');
}

function mkFixtureRoot() {
  const root = mkSocketFixtureRoot('bl1505-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    ['coder', 'coder', root, 'swarmforge-coder', 'Coder', 'claude', 'task'].join('\t') + '\n'
  );
  return root;
}

function writeFakeIdleTmux(dir, tmuxLog) {
  fs.mkdirSync(dir, { recursive: true });
  const body = [
    '#!/usr/bin/env bash',
    `echo "$*" >> "${tmuxLog}"`,
    'if [[ "$1 $2 $3" == "-S "*"has-session" ]]; then exit 0; fi',
    'exit 0',
    '',
  ].join('\n');
  const tmuxPath = path.join(dir, 'tmux');
  fs.writeFileSync(tmuxPath, body);
  fs.chmodSync(tmuxPath, 0o755);
}

async function waitFor(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function attributionFile(root) {
  const month = new Date().toISOString().slice(0, 7);
  return path.join(root, '.swarmforge', 'telemetry', `wake-attribution-${month}.jsonl`);
}

function chaserTelemetryFile(root) {
  const month = new Date().toISOString().slice(0, 7);
  return path.join(root, '.swarmforge', 'telemetry', `chaser-${month}.jsonl`);
}

function readJsonlLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function registerScenario02(registry) {
  registry.defineScoped(
    /^an aged parcel in a role's inbox whose mailbox is unchanged since the role's last wake$/,
    (ctx) => {
      const st = ensureState(ctx);
      st.root = mkFixtureRoot();
      st.tmuxLog = path.join(st.root, 'tmux-calls.log');
      st.fakeBinDir = path.join(st.root, 'bin');
      writeFakeIdleTmux(st.fakeBinDir, st.tmuxLog);

      const handoffName = '00_20260701T000000Z_000001_from_specifier_to_coder.handoff';
      const filePath = path.join(st.root, '.swarmforge', 'handoffs', 'inbox', 'new', handoffName);
      fs.writeFileSync(
        filePath,
        'id: bl1505-fixture\nfrom: specifier\nto: coder\npriority: 00\ntype: note\nmessage: hi\n\nhi\n'
      );
      const mtime = new Date(Date.now() - 45000);
      fs.utimesSync(filePath, mtime, mtime);
      st.filePath = filePath;

      // Pre-seed wake_dedup_lib.bb's per-role sidecar: the mailbox's own
      // CURRENT fingerprint, with lastInjectedAtMs far outside the default
      // 120000ms cooldown - decide-wake-dedup then answers :suppress
      // "unchanged-mailbox" (not "cooldown") from the very first chase
      // sweep, deterministically, rather than depending on delivery-wake/
      // chase-wake timing.
      const fingerprint = mailboxFingerprint(st.root);
      const dedupDir = path.join(st.root, '.swarmforge', 'daemon', 'wake-dedup');
      fs.mkdirSync(dedupDir, { recursive: true });
      fs.writeFileSync(
        path.join(dedupDir, 'coder.json'),
        JSON.stringify({ fingerprint, lastInjectedAtMs: Date.now() - 999999999, lastTargetEpoch: '' })
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the chase sweep chases it$/,
    async (ctx) => {
      const st = ensureState(ctx);
      const env = {
        ...process.env,
        PATH: `${st.fakeBinDir}:${process.env.PATH}`,
        SWARMFORGE_ALLOW_TMP_DAEMON: '1', // intentional throwaway test root (BL-406)
      };
      const child = spawn('bb', [HANDOFFD, st.root], { env, stdio: 'ignore' });
      st.daemon = child;

      await waitFor(() => fs.existsSync(`${st.filePath}.chase.json`), 20000);

      fs.mkdirSync(path.join(st.root, '.swarmforge', 'daemon'), { recursive: true });
      fs.writeFileSync(path.join(st.root, '.swarmforge', 'daemon', 'stop'), '');
      await waitFor(() => child.exitCode !== null || child.killed, 10000);
      try {
        child.kill('SIGKILL');
      } catch {
        /* already exited */
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the parcel's chase sidecar records one more chase$/,
    (ctx) => {
      const st = ensureState(ctx);
      const sidecarPath = `${st.filePath}.chase.json`;
      assert.ok(fs.existsSync(sidecarPath), `expected a .chase.json sidecar at ${sidecarPath}`);
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
      assert.ok(sidecar.chaseCount >= 1, `expected chaseCount >= 1, got: ${JSON.stringify(sidecar)}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^a chase telemetry event is logged for it$/,
    (ctx) => {
      const st = ensureState(ctx);
      const lines = readJsonlLines(chaserTelemetryFile(st.root));
      const chaseEvents = lines.filter((l) => l.type === 'chase' && l.role === 'coder');
      assert.ok(chaseEvents.length > 0, `expected a chase telemetry event for role coder, got: ${JSON.stringify(lines)}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the wake is attributed as skipped with reason unchanged-mailbox$/,
    (ctx) => {
      const st = ensureState(ctx);
      try {
        const lines = readJsonlLines(attributionFile(st.root));
        const skipped = lines.filter((l) => l.sweep === 'inbox-item' && l.role === 'coder' && l.outcome === 'skipped');
        assert.ok(skipped.length > 0, `expected a skipped inbox-item attribution for role coder, got: ${JSON.stringify(lines)}`);
        assert.ok(
          skipped.some((l) => l.skipReason === 'unchanged-mailbox'),
          `expected a skipReason of unchanged-mailbox, got: ${JSON.stringify(skipped)}`
        );
      } finally {
        if (st.daemon && st.daemon.exitCode === null && !st.daemon.killed) {
          try {
            st.daemon.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }
        if (st.root) {
          fs.rmSync(st.root, { recursive: true, force: true });
          releaseSocketFixtureRoot(st.root);
        }
      }
    },
    FEATURE
  );
}

// ── Scenario 03 ──────────────────────────────────────────────────────────

const MAX_CHASES = 3;
const BASE_MS = 1751500000000;
const CHASE_TIMEOUT_SECONDS = 30;
const STALE_MTIME_MS = BASE_MS - (CHASE_TIMEOUT_SECONDS + 5) * 1000;
const SWEEP_STEP_MS = 200000;

function mkPureFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1505-pure-'));
  for (const sub of ['new', 'in_process', 'completed', 'abandoned']) {
    fs.mkdirSync(path.join(root, 'inbox', sub), { recursive: true });
  }
  const handoffPath = path.join(root, 'inbox', 'new', '00_item.handoff');
  fs.writeFileSync(
    handoffPath,
    'id: t\nfrom: specifier\nto: coder\npriority: 50\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n'
  );
  fs.utimesSync(handoffPath, new Date(STALE_MTIME_MS), new Date(STALE_MTIME_MS));
  return { root, handoffPath };
}

// Drives run-sweep! MAX_CHASES times against a fresh fixture, with every
// :send-wake-up! call returning the same {:attempted true :landed <landed>}
// shape, and returns the resulting chaseCount.
function reachMaxChasesCount(landed) {
  const { root, handoffPath } = mkPureFixture();
  try {
    for (let i = 0; i < MAX_CHASES; i += 1) {
      const nowMs = BASE_MS + (i + 1) * SWEEP_STEP_MS;
      const script = `
(load-file "${CHASE}")
(def adapters
  {:get-liveness (fn [_role] "alive")
   :send-wake-up! (fn [_role] {:attempted true :landed ${landed}})
   :trigger-respawn! (fn [_role] nil)
   :log-dead-letter! (fn [_role _path] nil)
   :get-last-activity-ms (fn [_role] ${nowMs})
   :on-stuck-escalation! (fn [_role _escalated] nil)
   :log-telemetry! (fn [_event _now-ms] nil)
   :get-rate-limit-cooldown-until-ms (fn [_role] nil)
   :get-rate-limit-cooldown-woken-marker (fn [_role] nil)
   :mark-rate-limit-cooldown-woken! (fn [_role _until-ms] nil)})
(chase-sweep-lib/run-sweep!
 [{:role "coder"
   :inbox-new-dir "${path.join(root, 'inbox', 'new')}"
   :in-process-dir "${path.join(root, 'inbox', 'in_process')}"
   :completed-dir "${path.join(root, 'inbox', 'completed')}"
   :abandoned-dir "${path.join(root, 'inbox', 'abandoned')}"}]
 ${nowMs}
 {:chaseIntervalSeconds 1 :chaseTimeoutSeconds ${CHASE_TIMEOUT_SECONDS} :maxChases 1000
  :stuckInProcessTimeoutSeconds 1000000 :respawnCooldownSeconds 300}
 adapters)
`;
      execFileSync('bb', ['-e', script], { encoding: 'utf8' });
    }
    const sidecar = JSON.parse(fs.readFileSync(`${handoffPath}.chase.json`, 'utf8'));
    return sidecar.chaseCount;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function decideStaleItemAction(chaseCount, liveness) {
  const script = `(load-file "${CHASE}")\n(println (chase-sweep-lib/decide-stale-item-action ${chaseCount} {:maxChases ${MAX_CHASES}} "${liveness}"))`;
  return execFileSync('bb', ['-e', script], { encoding: 'utf8' }).trim();
}

function registerScenario03(registry) {
  registry.defineScoped(
    /^a parcel chased maxChases times with every wake dedup-suppressed$/,
    (ctx) => {
      const st = ensureState(ctx);
      st.suppressedChaseCount = reachMaxChasesCount('false');
      st.landedChaseCount = reachMaxChasesCount('true');
      assert.equal(
        st.suppressedChaseCount,
        MAX_CHASES,
        `expected the all-suppressed sequence to reach chaseCount ${MAX_CHASES}, got ${st.suppressedChaseCount}`
      );
      assert.equal(
        st.landedChaseCount,
        MAX_CHASES,
        `expected the all-landed sequence to reach chaseCount ${MAX_CHASES}, got ${st.landedChaseCount}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the chase sweep decides its next action$/,
    (ctx) => {
      const st = ensureState(ctx);
      // "dead" liveness so decide-stale-item-action answers "respawned"
      // once chaseCount reaches maxChases - proves the ladder actually
      // advances past "chased", not merely that two equal integers compare
      // equal.
      st.suppressedDecision = decideStaleItemAction(st.suppressedChaseCount, 'dead');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the decision is the same as for a parcel whose wakes all landed$/,
    (ctx) => {
      const st = ensureState(ctx);
      const landedDecision = decideStaleItemAction(st.landedChaseCount, 'dead');
      assert.equal(
        st.suppressedDecision,
        'respawned',
        `expected the all-suppressed sequence to reach "respawned", got "${st.suppressedDecision}"`
      );
      assert.equal(
        st.suppressedDecision,
        landedDecision,
        `expected the same verdict for a chaseCount reached via suppressed vs landed wakes: "${st.suppressedDecision}" vs "${landedDecision}"`
      );
    },
    FEATURE
  );
}

function registerSteps(registry) {
  registerScenario01(registry);
  registerScenario02(registry);
  registerScenario03(registry);
}

module.exports = { registerSteps };
