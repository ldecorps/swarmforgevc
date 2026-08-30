'use strict';

// BL-852: step handlers for "The chase sweep leaves ambulance-held parcels
// alone". Drives the REAL production code, never a reimplementation of the
// decision (bl655AmbulanceModeHoldSteps.js's own header states the same
// bar this file follows):
//   - the marker is written/cleared via the real ambulance_cli.bb
//     (engage/release), exactly as a human would from the CLI or Telegram.
//   - the sweep itself runs through chase_sweep_test_runner.bb, the SAME
//     real chase-sweep-lib/run-sweep! -> sweep-role-inbox! harness
//     swarmforge/scripts/test/test_chase_sweep.sh already exercises for
//     every non-ambulance scenario - fake adapters that log calls to a
//     file instead of touching tmux, never a hand-computed decision. BL-852
//     added an optional 5th CLI arg (role, default "coder") so this file's
//     "documenter" scenarios name the same role their Gherkin text does,
//     without duplicating the harness.
//
// Lighter than bl655's own fixture on purpose: this feature never exercises
// delivery/dequeue/rotation (no daemon --poll-once, no git worktrees), only
// the chase sweep's own per-role inbox scan - a single flat backlog/ +
// inbox/{new,in_process,completed,abandoned} tree per role is exactly what
// chase_sweep_test_runner.bb already expects.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const AMBULANCE_CLI = path.join(SCRIPTS_DIR, 'ambulance_cli.bb');
const CHASE_SWEEP_RUNNER = path.join(SCRIPTS_DIR, 'test', 'chase_sweep_test_runner.bb');

const CHASE_TIMEOUT_S = 30;
const STUCK_TIMEOUT_S = 60;
const MAX_CHASES = 3;
const NOW_MS = 1751500000 * 1000;
const PAST_CHASE_TIMEOUT_S = (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5;
const RECENT_ACTIVITY_MS = NOW_MS;
const IDLE_PAST_STUCK_MS = NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000;

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl852-ambulance-'));
  mkdirp(path.join(root, 'backlog', 'active'));
  return root;
}

function writeTicketYaml(root, id) {
  fs.writeFileSync(path.join(root, 'backlog', 'active', `${id}-fixture.yaml`), `id: ${id}\ntitle: "fixture ticket"\nstatus: active\n`);
}

function runAmbulanceCli(ctx, args) {
  const result = spawnSync('bb', [AMBULANCE_CLI, ctx.root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`ambulance_cli.bb ${args.join(' ')} failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

// chase_sweep_test_runner.bb's fixture-root argument serves BOTH roles: the
// base of its inbox/{new,in_process,completed,abandoned} tree AND (via
// set-project-root!) the target-root ambulance_cli.bb/backlog/ resolve
// against. A per-role subdirectory would split those two - the marker
// written at ctx.root would then sit outside the project-root the runner
// resolves from a role subdir, and every parcel would silently read as
// never-held. One flat ctx.root per scenario keeps them the same directory,
// exactly like chase_sweep_test_runner.bb's own existing coder-only
// scenarios already rely on. No scenario in this feature needs two roles'
// inboxes in the same sweep, so this is never a real constraint.
function ensureInboxDirs(ctx) {
  for (const sub of ['inbox/new', 'inbox/in_process', 'inbox/completed', 'inbox/abandoned']) {
    mkdirp(path.join(ctx.root, sub));
  }
  return ctx.root;
}

function setMtime(filePath, epochSeconds) {
  const t = new Date(epochSeconds * 1000);
  fs.utimesSync(filePath, t, t);
}

function writeHandoff(dir, { task, to = 'documenter' }) {
  const filename = '00_item.handoff';
  const content = `id: t\nfrom: specifier\nto: ${to}\npriority: 50\ntype: git_handoff\ntask: ${task}\ncommit: 0000000000\ncreated_at: 2026-07-01T00:00:00Z\n\npayload\n`;
  const file = path.join(dir, filename);
  fs.writeFileSync(file, content);
  return file;
}

function chaseJsonPath(handoffFile) {
  return `${handoffFile}.chase.json`;
}

function writeChaseCount(handoffFile, chaseCount, lastChasedAtMs) {
  const body = { chaseCount, ...(lastChasedAtMs !== undefined ? { lastChasedAtMs } : {}) };
  fs.writeFileSync(chaseJsonPath(handoffFile), JSON.stringify(body));
}

function readChaseCount(handoffFile) {
  const p = chaseJsonPath(handoffFile);
  if (!fs.existsSync(p)) return 0;
  return JSON.parse(fs.readFileSync(p, 'utf8')).chaseCount;
}

function callsLogPath(fixtureRoot) {
  return path.join(fixtureRoot, 'calls.log');
}

function readCallsLog(fixtureRoot) {
  const p = callsLogPath(fixtureRoot);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function runSweep(fixtureRoot, { liveness = 'alive', lastActivityMs = RECENT_ACTIVITY_MS, role = 'documenter' } = {}) {
  const result = spawnSync(
    'bb',
    [CHASE_SWEEP_RUNNER, fixtureRoot, String(NOW_MS), liveness, String(lastActivityMs), role],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CHASE_TIMEOUT_SECONDS: String(CHASE_TIMEOUT_S),
        STUCK_TIMEOUT_SECONDS: String(STUCK_TIMEOUT_S),
        MAX_CHASES: String(MAX_CHASES),
      },
    }
  );
  if (result.status !== 0) {
    throw new Error(`chase_sweep_test_runner.bb failed: ${result.stderr}`);
  }
}

function snapshotFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a running swarm with a mailbox for every role$/, (ctx) => {
    ctx.root = mkRoot();
    ensureInboxDirs(ctx);
  });

  registry.define(/^ambulance mode is engaged for (BL-\d+)$/, (ctx, ticket) => {
    writeTicketYaml(ctx.root, ticket);
    runAmbulanceCli(ctx, ['engage', ticket]);
  });

  // ── shared Given steps ───────────────────────────────────────────────
  registry.define(/^a git_handoff for task (BL-\d+) has waited in the (\w+) inbox past the chase timeout$/, (ctx, ticket, role) => {
    const fixtureRoot = ensureInboxDirs(ctx);
    const file = writeHandoff(path.join(fixtureRoot, 'inbox', 'new'), { task: ticket, to: role });
    setMtime(file, PAST_CHASE_TIMEOUT_S);
    ctx.role = role;
    ctx.fixtureRoot = fixtureRoot;
    ctx.itemFile = file;
    ctx.beforeContent = snapshotFile(file);
    ctx.beforeChaseJson = snapshotFile(chaseJsonPath(file));
  });

  registry.define(/^its chase count has already reached the maximum$/, (ctx) => {
    writeChaseCount(ctx.itemFile, MAX_CHASES);
    ctx.beforeContent = snapshotFile(ctx.itemFile);
    ctx.beforeChaseJson = snapshotFile(chaseJsonPath(ctx.itemFile));
  });

  registry.define(/^documenter liveness reads (\w+)$/, (ctx, liveness) => {
    ctx.liveness = liveness;
  });

  registry.define(/^documenter has been idle past the stuck timeout$/, (ctx) => {
    ctx.lastActivityMs = IDLE_PAST_STUCK_MS;
  });

  registry.define(/^it has been held unchanged across three chase sweeps$/, (ctx) => {
    writeChaseCount(ctx.itemFile, 2);
    ctx.frozenChaseCount = 2;
    for (let i = 0; i < 3; i++) {
      runSweep(ctx.fixtureRoot, { role: ctx.role, liveness: ctx.liveness || 'alive', lastActivityMs: ctx.lastActivityMs ?? RECENT_ACTIVITY_MS });
    }
    if (readChaseCount(ctx.itemFile) !== 2) {
      throw new Error(`expected chaseCount to stay frozen at 2 across three held sweeps, got ${readChaseCount(ctx.itemFile)}`);
    }
  });

  registry.define(/^a parcel with the same name is already recorded in the (\w+) completed folder$/, (ctx, role) => {
    const fixtureRoot = ensureInboxDirs(ctx);
    writeHandoff(path.join(fixtureRoot, 'inbox', 'completed'), { task: 'BL-660', to: role });
  });

  registry.define(/^a git_handoff for task (BL-\d+) is already claimed in the (\w+) in_process folder$/, (ctx, ticket, role) => {
    const fixtureRoot = ensureInboxDirs(ctx);
    const file = writeHandoff(path.join(fixtureRoot, 'inbox', 'in_process'), { task: ticket, to: role });
    ctx.role = role;
    ctx.fixtureRoot = fixtureRoot;
    ctx.itemFile = file;
  });

  registry.define(/^the ambulance is released$/, (ctx) => {
    if (!ctx.root) {
      ctx.root = mkRoot();
      ensureInboxDirs(ctx);
    }
    runAmbulanceCli(ctx, ['release']);
  });

  // ── When ───────────────────────────────────────────────────────────────
  registry.define(/^the handoff daemon runs one chase sweep$/, (ctx) => {
    runSweep(ctx.fixtureRoot, { role: ctx.role, liveness: ctx.liveness || 'alive', lastActivityMs: ctx.lastActivityMs ?? RECENT_ACTIVITY_MS });
    ctx.log = readCallsLog(ctx.fixtureRoot);
  });

  // ── Then ─────────────────────────────────────────────────────────────
  registry.define(/^no wake-up is sent to (\w+)$/, (ctx, role) => {
    if (new RegExp(`^wake-up ${role}$`, 'm').test(ctx.log)) {
      throw new Error(`expected no wake-up sent to ${role}, got: ${ctx.log}`);
    }
  });

  registry.define(/^a wake-up is sent to (\w+)$/, (ctx, role) => {
    if (!new RegExp(`^wake-up ${role}$`, 'm').test(ctx.log)) {
      throw new Error(`expected a wake-up sent to ${role}, got: ${ctx.log}`);
    }
  });

  registry.define(/^no chase telemetry is recorded for that parcel$/, (ctx) => {
    if (/^telemetry chase /m.test(ctx.log)) {
      throw new Error(`expected no chase telemetry, got: ${ctx.log}`);
    }
  });

  registry.define(/^no respawn is triggered for (\w+)$/, (ctx, role) => {
    if (new RegExp(`^respawn ${role}$`, 'm').test(ctx.log)) {
      throw new Error(`expected no respawn triggered for ${role}, got: ${ctx.log}`);
    }
  });

  registry.define(/^no dead-letter file is created for that parcel$/, (ctx) => {
    if (fs.existsSync(`${ctx.itemFile}.dead`)) {
      throw new Error('expected no .dead file to be created for the held parcel');
    }
  });

  registry.define(/^that parcel and its sidecars are byte-identical to before the sweep$/, (ctx) => {
    const afterContent = snapshotFile(ctx.itemFile);
    const afterChaseJson = snapshotFile(chaseJsonPath(ctx.itemFile));
    if (afterContent !== ctx.beforeContent) {
      throw new Error('expected the held parcel content to be byte-identical after the sweep');
    }
    if (afterChaseJson !== ctx.beforeChaseJson) {
      throw new Error(
        `expected the held parcel's .chase.json sidecar to be byte-identical after the sweep, before=${ctx.beforeChaseJson} after=${afterChaseJson}`
      );
    }
  });

  registry.define(/^that parcel's chase count is one higher than before the sweep$/, (ctx) => {
    const before = ctx.beforeChaseJson ? JSON.parse(ctx.beforeChaseJson).chaseCount : 0;
    const after = readChaseCount(ctx.itemFile);
    if (after !== before + 1) {
      throw new Error(`expected chaseCount to advance by exactly one (before=${before}), got ${after}`);
    }
  });

  registry.define(/^that parcel's chase count is one higher than it was when the ambulance was engaged$/, (ctx) => {
    const after = readChaseCount(ctx.itemFile);
    if (after !== ctx.frozenChaseCount + 1) {
      throw new Error(`expected chaseCount to resume from the frozen value ${ctx.frozenChaseCount} + 1, got ${after}`);
    }
  });

  registry.define(/^that parcel is removed from the documenter inbox$/, (ctx) => {
    if (fs.existsSync(ctx.itemFile)) {
      throw new Error('expected the terminal duplicate to be removed (reaped) from the inbox');
    }
  });

  registry.define(/^the sweep outcome matches what the same fixture produces with no marker file at all$/, (ctx) => {
    // A second, otherwise-identical fixture that never calls ambulance_cli.bb
    // at all - no marker file whatsoever, as distinct from an explicitly
    // released (active:false) marker. Both must degrade to the exact same
    // "not held" decision (ambulance-lib/read-ambulance-state's own
    // documented {:active false} degrade-to-off contract).
    const bareCtx = { root: mkRoot() };
    const bareFixture = ensureInboxDirs(bareCtx);
    const bareFile = writeHandoff(path.join(bareFixture, 'inbox', 'new'), { task: 'BL-660', to: ctx.role });
    setMtime(bareFile, PAST_CHASE_TIMEOUT_S);
    runSweep(bareFixture, { role: ctx.role, liveness: 'alive', lastActivityMs: RECENT_ACTIVITY_MS });
    const bareLog = readCallsLog(bareFixture);
    if (bareLog !== ctx.log) {
      throw new Error(`expected the released-marker sweep to match the no-marker-at-all sweep byte-for-byte; released=${JSON.stringify(ctx.log)} no-marker=${JSON.stringify(bareLog)}`);
    }
    if (readChaseCount(bareFile) !== readChaseCount(ctx.itemFile)) {
      throw new Error('expected the released-marker and no-marker fixtures to reach the same chaseCount');
    }
  });
}

module.exports = { registerSteps };
