'use strict';

// BL-900: step handlers for "promotion ranking considers the containing
// epic's priority before the ticket's own". Drives the REAL
// promotion_gates_cli.bb `select` (and, for scenario 06, the real
// promote_and_route_next.sh) against a real fixture git repo - same
// "drive the real script against a real fixture repo" pattern as
// bl854OrthogonalityAdvisesInsteadOfBlockingSteps.js /
// bl663PromotionGatesSteps.js.
//
// Ranking (scenarios 01-05) never needs the depth/hold/approval gates, so
// every fixture candidate is written `human_approval: approved`, under a
// roomy cap, with no active/ occupant - `select`'s own `evaluate` pre-filter
// would otherwise silently drop a candidate before ranking ever saw it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GATES_CLI = path.join(SCRIPTS_DIR, 'promotion_gates_cli.bb');
const PROMOTE_SCRIPT = path.join(SCRIPTS_DIR, 'promote_and_route_next.sh');

const FEATURE_NAME = "Promotion ranking considers the containing epic's priority before the ticket's own";

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Never {...process.env} - an explicit allowlist, never leak this box's own
// broader environment into a spawned bb/bash subprocess (same posture as
// bl854's own processEnvAllowlist).
function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function initFixture(ctx) {
  if (ctx.root) {
    return;
  }
  ctx.root = mkTmp('bl900-epic-priority-');
  ctx.candidates = []; // ordered list of {id, file}
  ctx.epicCounter = 0;
  git(ctx.root, ['init', '-q']);
  git(ctx.root, ['config', 'user.email', 't@t']);
  git(ctx.root, ['config', 'user.name', 't']);
  git(ctx.root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(ctx.root, 'swarmforge'));
  fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 5\n');
}

function writeEpicTracker(root, epicName, priority) {
  mkdirp(path.join(root, 'backlog', 'paused'));
  const id = `TR-${epicName}-${priority}`;
  fs.writeFileSync(
    path.join(root, 'backlog', 'paused', `${id}-tracker.yaml`),
    `id: ${id}\ntitle: "epic tracker ${epicName}"\ntype: epic\nepic: ${epicName}\npriority: ${priority}\n`
  );
}

function writeCandidate(ctx, id, { type = 'feature', severity, priority, epic } = {}) {
  mkdirp(path.join(ctx.root, 'backlog', 'paused'));
  const file = path.join(ctx.root, 'backlog', 'paused', `${id}-candidate.yaml`);
  const lines = [
    `id: ${id}`,
    `title: "candidate ${id}"`,
    `type: ${type}`,
    ...(severity ? [`severity: ${severity}`] : []),
    `priority: ${priority}`,
    ...(epic ? [`epic: ${epic}`] : []),
    'human_approval: approved',
    'assigned_to:',
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  ctx.candidates.push({ id, file });
  return file;
}

function nextEpicName(ctx, prefix) {
  ctx.epicCounter += 1;
  return `${prefix}-${ctx.epicCounter}`;
}

function select(ctx, files) {
  const res = spawnSync('bb', [GATES_CLI, 'select', ctx.root, '5', ...files], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: processEnvAllowlist(),
  });
  return { status: res.status, stdout: (res.stdout || '').trim(), stderr: res.stderr || '' };
}

// The FULL ranked id sequence, by repeatedly asking `select` for the winner
// among the remaining files and removing it - drives the real production
// chokepoint rather than re-deriving a sort independently.
function rankedOrder(ctx, files) {
  let remaining = [...files];
  const order = [];
  while (remaining.length) {
    const result = select(ctx, remaining);
    if (result.status !== 0 || result.stdout === 'NONE') {
      break;
    }
    const winnerFile = result.stdout;
    const winnerId = ctx.candidates.find((c) => c.file === winnerFile)?.id;
    order.push(winnerId);
    remaining = remaining.filter((f) => f !== winnerFile);
  }
  return order;
}

function commitAll(ctx, message) {
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['commit', '-q', '-m', message]);
}

function findYamlStartingWith(dir, prefix) {
  if (!fs.existsSync(dir)) {
    return null;
  }
  const match = fs.readdirSync(dir).find((name) => name.startsWith(`${prefix}-`) && name.endsWith('.yaml'));
  return match ? path.join(dir, match) : null;
}

function runPromoteScript(ctx) {
  const res = spawnSync('bash', [PROMOTE_SCRIPT, ctx.root], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: processEnvAllowlist(),
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────

  registry.defineScoped(/^a backlog whose eligible candidates are ranked for promotion$/, (ctx) => {
    initFixture(ctx);
  }, FEATURE_NAME);

  // ── Given ────────────────────────────────────────────────────────────

  registry.defineScoped(
    /^a candidate "(BL-\w+)" whose epic tracker priority is (\d+) and whose own priority is (\d+)$/,
    (ctx, id, epicPriority, ownPriority) => {
      initFixture(ctx);
      const epic = nextEpicName(ctx, `epic-for-${id}`);
      writeEpicTracker(ctx.root, epic, epicPriority);
      writeCandidate(ctx, id, { priority: ownPriority, epic });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a candidate "(BL-\w+)" of type "(\w+)" with severity "(\w+)" whose epic tracker priority is (\d+)$/,
    (ctx, id, type, severity, epicPriority) => {
      initFixture(ctx);
      const epic = nextEpicName(ctx, `epic-for-${id}`);
      writeEpicTracker(ctx.root, epic, epicPriority);
      // No own priority is named for this fixture - an arbitrary mid-range
      // value, deliberately WORSE (numerically higher) than every other
      // candidate's own priority in this scenario, so a pass here can only
      // be explained by the expedite bucket, never by own-priority luck.
      writeCandidate(ctx, id, { type, severity, priority: 999, epic });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a candidate "(BL-\w+)" whose epic has no tracker and whose own priority is (\d+)$/,
    (ctx, id, ownPriority) => {
      initFixture(ctx);
      // Deliberately no writeEpicTracker call - the candidate's epic: names
      // an epic that has no tracker anywhere in the backlog.
      const epic = nextEpicName(ctx, `untracked-epic-for-${id}`);
      writeCandidate(ctx, id, { priority: ownPriority, epic });
    },
    FEATURE_NAME
  );

  registry.defineScoped(/^an epic "([\w-]+)" with tracker priorities (\d+), (\d+) and (\d+)$/, (ctx, epic, p1, p2, p3) => {
    initFixture(ctx);
    writeEpicTracker(ctx.root, epic, p1);
    writeEpicTracker(ctx.root, epic, p2);
    writeEpicTracker(ctx.root, epic, p3);
  }, FEATURE_NAME);

  registry.defineScoped(/^a candidate "(BL-\w+)" in epic "([\w-]+)" whose own priority is (\d+)$/, (ctx, id, epic, ownPriority) => {
    initFixture(ctx);
    writeCandidate(ctx, id, { priority: ownPriority, epic });
  }, FEATURE_NAME);

  registry.defineScoped(/^candidates whose epic priorities are variously absent, duplicated and unparseable$/, (ctx) => {
    initFixture(ctx);
    // absent: no epic tracker at all.
    writeCandidate(ctx, 'BL-J', { priority: 20, epic: nextEpicName(ctx, 'absent-epic') });
    // duplicated: two trackers for the same epic, most urgent (5) should win.
    const dupEpic = nextEpicName(ctx, 'dup-epic');
    writeEpicTracker(ctx.root, dupEpic, 40);
    writeEpicTracker(ctx.root, dupEpic, 5);
    writeCandidate(ctx, 'BL-K', { priority: 3, epic: dupEpic });
    // unparseable: a tracker priority that is not a number falls back to
    // 999999 (sorts last), same as read-priority's own fallback elsewhere.
    const unparseableEpic = nextEpicName(ctx, 'unparseable-epic');
    mkdirp(path.join(ctx.root, 'backlog', 'paused'));
    fs.writeFileSync(
      path.join(ctx.root, 'backlog', 'paused', `TR-${unparseableEpic}-fixture.yaml`),
      `id: TR-${unparseableEpic}\ntype: epic\nepic: ${unparseableEpic}\npriority: not-a-number\n`
    );
    writeCandidate(ctx, 'BL-L', { priority: 7, epic: unparseableEpic });
    // no epic field at all.
    writeCandidate(ctx, 'BL-M', { priority: 15 });
  }, FEATURE_NAME);

  registry.defineScoped(/^the active backlog is already at its configured maximum depth$/, (ctx) => {
    initFixture(ctx);
    fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 1\n');
    mkdirp(path.join(ctx.root, 'backlog', 'active'));
    fs.writeFileSync(
      path.join(ctx.root, 'backlog', 'active', 'BL-900-occupant-fixture.yaml'),
      'id: BL-900-occupant\ntitle: "occupant"\ntype: feature\npriority: 50\nepic: occupant-epic\nhuman_approval: approved\nassigned_to: coder\n'
    );
  }, FEATURE_NAME);

  registry.defineScoped(/^a candidate from the most urgent epic is eligible$/, (ctx) => {
    const epic = nextEpicName(ctx, 'urgent-epic');
    writeEpicTracker(ctx.root, epic, 1);
    ctx.depthCapId = 'BL-901';
    writeCandidate(ctx, ctx.depthCapId, { priority: 1, epic });
    commitAll(ctx, 'seed BL-900 depth-cap fixture');
  }, FEATURE_NAME);

  // ── When ─────────────────────────────────────────────────────────────

  registry.defineScoped(/^the candidates are ranked$/, (ctx) => {
    const files = ctx.candidates.map((c) => c.file);
    const result = select(ctx, files);
    ctx.winnerId = ctx.candidates.find((c) => c.file === result.stdout)?.id;
    ctx.selectResult = result;
  }, FEATURE_NAME);

  registry.defineScoped(/^the candidates are ranked twice, the second time from a shuffled enumeration$/, (ctx) => {
    const files = ctx.candidates.map((c) => c.file);
    const reversedFiles = [...files].reverse();
    ctx.forwardOrder = rankedOrder(ctx, files);
    ctx.reversedOrder = rankedOrder(ctx, reversedFiles);
  }, FEATURE_NAME);

  registry.defineScoped(/^the coordinator runs promotion$/, (ctx) => {
    ctx.result = runPromoteScript(ctx);
  }, FEATURE_NAME);

  // ── Then ─────────────────────────────────────────────────────────────

  registry.defineScoped(/^"(BL-\w+)" is ranked first$/, (ctx, id) => {
    if (ctx.winnerId !== id) {
      throw new Error(
        `expected ${id} to rank first, got ${ctx.winnerId || '(none)'}. select output: ${JSON.stringify(ctx.selectResult)}`
      );
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^both rankings are identical$/, (ctx) => {
    if (JSON.stringify(ctx.forwardOrder) !== JSON.stringify(ctx.reversedOrder)) {
      throw new Error(
        `ranking order depends on enumeration order: forward=${JSON.stringify(ctx.forwardOrder)} reversed=${JSON.stringify(ctx.reversedOrder)}`
      );
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^no candidate is promoted$/, (ctx) => {
    const activeFile = findYamlStartingWith(path.join(ctx.root, 'backlog', 'active'), ctx.depthCapId);
    if (activeFile) {
      throw new Error(`expected ${ctx.depthCapId} NOT to be promoted at cap, but found it in backlog/active/`);
    }
    const stillPaused = findYamlStartingWith(path.join(ctx.root, 'backlog', 'paused'), ctx.depthCapId);
    if (!stillPaused) {
      throw new Error(`expected ${ctx.depthCapId} to remain in backlog/paused/, but it is gone`);
    }
  }, FEATURE_NAME);
}

module.exports = { registerSteps };
