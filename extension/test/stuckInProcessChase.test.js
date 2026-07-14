const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runSweep, writeNudgeCount, readNudgeCount } = require('../out/swarm/inboxChaser');
const { buildRoleInboxes } = require('../out/watchdog/chaserMonitor');

// BL-067: the live chase machinery missed a 4h overnight stall. Two root
// causes: (1) runSweep only aged inbox/new deliveries — the in_process
// reconciler was dead code the periodic monitor never invoked; (2) the
// monitor built inbox paths as <target>/.swarmforge/handoffs/<role>/inbox/new,
// a layout that does not exist — the real inboxes live per worktree at
// <worktree>/.swarmforge/handoffs/inbox/new (roles.tsv). These tests pin both.

const CONFIG = {
  chaseIntervalSeconds: 5,
  chaseTimeoutSeconds: 30,
  maxChases: 3,
  stuckInProcessTimeoutSeconds: 60,
};

function mkWorktree() {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stuck-'));
  fs.mkdirSync(path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  return wt;
}

function roleInbox(role, wt) {
  return {
    role,
    inboxNewDir: path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'new'),
    inProcessDir: path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'in_process'),
  };
}

function holdTask(wt, name) {
  const file = path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'in_process', `${name}.handoff`);
  fs.writeFileSync(file, 'from: QA\ntask: BL-000-x\n\nbody\n');
  return file;
}

function holdBatch(wt, name, count) {
  const dir = path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'in_process', `batch_${name}`);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (let i = 0; i < count; i++) {
    const file = path.join(dir, `item${i}.handoff`);
    fs.writeFileSync(file, 'from: architect\ntask: BL-000-y\n\nbody\n');
    files.push(file);
  }
  return files;
}

function makeAdapters(activityMsByRole, nowMs) {
  const wakeUps = [];
  const escalations = [];
  return {
    wakeUps,
    escalations,
    adapters: {
      getLiveness: () => 'idle',
      sendWakeUp: (role) => wakeUps.push(role),
      triggerRespawn: () => {},
      logDeadLetter: () => {},
      getLastActivityMs: (role) => activityMsByRole[role] ?? nowMs,
      onStuckEscalation: (role, escalated) => escalations.push([role, escalated]),
    },
  };
}

const NOW = Date.parse('2026-07-02T06:00:00Z');
const FOUR_HOURS_AGO = NOW - 4 * 3600 * 1000;
const JUST_NOW = NOW - 5 * 1000;

// --- BL-067 stuck-inprocess-chase-01: idle holder gets chased ---

test('an idle role holding a single in_process task file is chased', () => {
  const wt = mkWorktree();
  holdTask(wt, '00_held');
  const { adapters, wakeUps } = makeAdapters({ specifier: FOUR_HOURS_AGO }, NOW);
  runSweep([roleInbox('specifier', wt)], NOW, CONFIG, adapters);
  assert.deepEqual(wakeUps, ['specifier'], 'the idle in_process holder must be nudged');
});

test('an idle role holding a batch DIRECTORY is chased (the hardender shape)', () => {
  const wt = mkWorktree();
  holdBatch(wt, '20260702T0129', 5);
  const { adapters, wakeUps } = makeAdapters({ hardender: FOUR_HOURS_AGO }, NOW);
  runSweep([roleInbox('hardender', wt)], NOW, CONFIG, adapters);
  assert.deepEqual(wakeUps, ['hardender'], 'a batch holder must be nudged too');
});

test('one nudge per sweep per role, even with several held items', () => {
  const wt = mkWorktree();
  holdTask(wt, '00_a');
  holdTask(wt, '00_b');
  const { adapters, wakeUps } = makeAdapters({ specifier: FOUR_HOURS_AGO }, NOW);
  runSweep([roleInbox('specifier', wt)], NOW, CONFIG, adapters);
  assert.equal(wakeUps.length, 1, 'a role gets one nudge per sweep, not one per item');
});

// --- BL-067 stuck-inprocess-chase-03: an active agent is never chased ---

test('a role with recent pane activity is not chased despite holding work', () => {
  const wt = mkWorktree();
  holdTask(wt, '00_busy');
  const { adapters, wakeUps, escalations } = makeAdapters({ coder: JUST_NOW }, NOW);
  runSweep([roleInbox('coder', wt)], NOW, CONFIG, adapters);
  assert.deepEqual(wakeUps, [], 'an actively working agent must never be chased');
  assert.ok(
    escalations.every(([, escalated]) => escalated === false),
    'no escalation for an active agent'
  );
});

test('fresh activity resets accumulated nudge counts', () => {
  const wt = mkWorktree();
  const file = holdTask(wt, '00_recovering');
  writeNudgeCount(file, 2);
  const { adapters } = makeAdapters({ coder: JUST_NOW }, NOW);
  runSweep([roleInbox('coder', wt)], NOW, CONFIG, adapters);
  assert.equal(readNudgeCount(file), 0, 'recovery must clear stale nudge counts');
});

// --- BL-067 stuck-inprocess-chase-02: bounded chases, then escalate ---

test('after max chases with no recovery, no more nudges and the tile escalates', () => {
  const wt = mkWorktree();
  const file = holdTask(wt, '00_hopeless');
  writeNudgeCount(file, CONFIG.maxChases);
  const { adapters, wakeUps, escalations } = makeAdapters({ specifier: FOUR_HOURS_AGO }, NOW);
  runSweep([roleInbox('specifier', wt)], NOW, CONFIG, adapters);
  assert.deepEqual(wakeUps, [], 'chases are bounded');
  assert.deepEqual(escalations, [['specifier', true]], 'exhausted chases must escalate visibly');
});

test('nudge counts accumulate across sweeps up to the cap', () => {
  const wt = mkWorktree();
  const file = holdTask(wt, '00_counting');
  const { adapters } = makeAdapters({ specifier: FOUR_HOURS_AGO }, NOW);
  runSweep([roleInbox('specifier', wt)], NOW, CONFIG, adapters);
  runSweep([roleInbox('specifier', wt)], NOW, CONFIG, adapters);
  assert.equal(readNudgeCount(file), 2);
});

// --- BL-067 stuck-inprocess-chase-04: the recorded overnight stall ---

test('REGRESSION: the 2026-07-02 overnight stall is caught without human help', () => {
  // Recorded state: specifier held a single QA handoff in in_process from
  // 01:42; hardender held a 5-parcel batch directory from 01:29; both panes
  // idle for ~4 hours; daemon healthy (inbox/new empty everywhere).
  const specifierWt = mkWorktree();
  const hardenderWt = mkWorktree();
  holdTask(specifierWt, '00_20260702T014203Z_000047_from_QA_to_specifier');
  holdBatch(hardenderWt, '20260702T012900', 5);

  const inboxes = [roleInbox('specifier', specifierWt), roleInbox('hardender', hardenderWt)];
  const activity = { specifier: FOUR_HOURS_AGO, hardender: FOUR_HOURS_AGO };

  // chase phase
  let res = makeAdapters(activity, NOW);
  runSweep(inboxes, NOW, CONFIG, res.adapters);
  assert.deepEqual(res.wakeUps.sort(), ['hardender', 'specifier'], 'both stalled holders are chased');

  // absent recovery, chases exhaust and escalation follows — no human involved
  for (let i = 0; i < CONFIG.maxChases; i++) {
    res = makeAdapters(activity, NOW);
    runSweep(inboxes, NOW, CONFIG, res.adapters);
  }
  const escalated = res.escalations.filter(([, e]) => e).map(([r]) => r).sort();
  assert.deepEqual(escalated, ['hardender', 'specifier'], 'unrecovered stall must escalate visibly');
});

// --- root cause 2: the monitor must sweep the REAL per-worktree inboxes ---

test('REGRESSION: buildRoleInboxes resolves per-worktree inbox paths from roles.tsv', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-target-'));
  const wt = path.join(target, '.worktrees', 'coder');
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${target}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n` +
      `coder\tcoder\t${wt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );

  const inboxes = buildRoleInboxes(target, ['specifier', 'coder']);

  const coder = inboxes.find((i) => i.role === 'coder');
  assert.equal(coder.inboxNewDir, path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'new'));
  assert.equal(coder.inProcessDir, path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'in_process'));
  const specifier = inboxes.find((i) => i.role === 'specifier');
  assert.equal(
    specifier.inboxNewDir,
    path.join(target, '.swarmforge', 'handoffs', 'inbox', 'new'),
    'master roles use the project root worktree, never a per-role handoffs/<role>/ layout'
  );
});

test('buildRoleInboxes returns an empty list when roles.tsv is missing, instead of throwing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-target-'));
  assert.deepEqual(buildRoleInboxes(target, ['specifier', 'coder']), []);
});

test('buildRoleInboxes only includes roles present in rolesList, even if roles.tsv has more', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-target-'));
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${target}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n` +
      `coder\tcoder\t${target}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );

  const inboxes = buildRoleInboxes(target, ['coder']);

  assert.deepEqual(inboxes.map((i) => i.role), ['coder']);
});
