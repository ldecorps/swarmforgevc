'use strict';

// BL-1301: step handlers for "an explicitly parked active ticket is not
// reported as a dropped parcel". Every scenario drives the REAL sweep -
// chase_sweep_lib.bb through dropped_parcel_sweep_harness.bb (the same thin
// wrapper BL-719's own steps use, mirroring handoffd.bb's
// dropped-parcel-sweep! exactly, suppression logging included) and, for
// scenario 04, dispatch_gap_sweep_harness.bb - never a live daemon or tmux
// session, and never a JS re-statement of the decision.
//
// Steps are registered SCOPED to this feature: "the dropped-parcel sweep
// evaluates it" and its siblings read naturally in several features, and
// the registry is first-match, so an unscoped registration here would
// silently claim another feature's text (or be claimed by it).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const DROPPED_PARCEL_HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'dropped_parcel_sweep_harness.bb');
const DISPATCH_GAP_HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'dispatch_gap_sweep_harness.bb');

const FEATURE = 'An explicitly parked active ticket is not reported as a dropped parcel';

const ITEM_ID = 'BL-1301';
// Fixed and small so the harness never waits on wall-clock time - only the
// fixture trail file's own enqueued_at decides stale vs fresh.
const STALL_THRESHOLD_MS = 60000;
const COOLDOWN_MS = 60000;
const STALE_INSTANT = '2020-01-01T00:00:00.000000Z';

// KNOWN_VALUES: the outline's tokens, validated explicitly rather than
// passed through - an unrecognised status or verdict must fail loudly.
const KNOWN_STATUSES = new Set(['blocked', 'todo', 'needs_design', 'superseded', 'paused']);
const KNOWN_VERDICTS = new Set(['yes', 'no']);

const trackedRoots = [];

afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function coderWorktree(ctx) {
  return path.join(ctx.root, '.worktrees', 'coder');
}

function writeRolesTsv(ctx) {
  fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
  const rows = [
    ['coordinator', 'master', ctx.root, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
    ['coder', 'coder', coderWorktree(ctx), 'swarmforge-coder', 'Coder', 'claude', 'task'],
  ];
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function activeItemPath(ctx) {
  return path.join(ctx.root, 'backlog', 'active', `${ITEM_ID}-demo.yaml`);
}

// status === null writes no status: line at all (scenario 02).
function writeActiveItem(ctx, status) {
  fs.mkdirSync(path.dirname(activeItemPath(ctx)), { recursive: true });
  const statusLine = status === null ? '' : `status: ${status}\n`;
  fs.writeFileSync(activeItemPath(ctx), `id: ${ITEM_ID}\ntitle: "demo"\n${statusLine}assigned_to: coder\n`);
}

function trailDir(ctx) {
  return path.join(coderWorktree(ctx), '.swarmforge', 'handoffs', 'sent');
}

function writeStaleTrail(ctx) {
  fs.mkdirSync(trailDir(ctx), { recursive: true });
  const headers = {
    from: 'documenter',
    to: 'QA',
    type: 'git_handoff',
    task: `${ITEM_ID}-demo`,
    commit: '0000000000',
    enqueued_at: STALE_INSTANT,
  };
  fs.writeFileSync(
    path.join(trailDir(ctx), '00_trail.handoff'),
    Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\nbody\n'
  );
}

function coordinatorOutbox(ctx) {
  const dir = path.join(ctx.root, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
  } catch {
    files = [];
  }
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
}

function droppedParcelNudges(ctx) {
  return coordinatorOutbox(ctx).filter((c) => new RegExp(`^message: ${ITEM_ID} no parcel in flight`, 'm').test(c));
}

function daemonLog(ctx) {
  try {
    return fs.readFileSync(path.join(ctx.root, '.swarmforge', 'daemon', 'handoffd.log'), 'utf8');
  } catch {
    return '';
  }
}

function runDroppedParcelSweep(ctx) {
  ctx.sweepOutput = execFileSync(
    'bb',
    [DROPPED_PARCEL_HARNESS, ctx.root, String(STALL_THRESHOLD_MS), String(COOLDOWN_MS)],
    { encoding: 'utf8' }
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────────
  scoped(
    /^an active ticket with a trail, no parcel in flight anywhere, and a trail stale past the threshold$/,
    (ctx) => {
      ctx.root = mkSocketFixtureRoot('bl1301-');
      trackedRoots.push(ctx.root);
      git(ctx.root, ['init', '-q']);
      git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
      writeRolesTsv(ctx);
      // The mint status until a scenario states otherwise; every mailbox
      // starts empty, so nothing is in flight anywhere.
      writeActiveItem(ctx, 'todo');
      writeStaleTrail(ctx);
    }
  );

  // ── Scenario 01 (outline) / 03 ───────────────────────────────────────────
  scoped(/^the active ticket declares status "([^"]+)"$/, (ctx, status) => {
    if (!KNOWN_STATUSES.has(status)) {
      throw new Error(`unknown <status> token: ${status}`);
    }
    writeActiveItem(ctx, status);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────────
  scoped(/^the active ticket carries no status field$/, (ctx) => {
    writeActiveItem(ctx, null);
    assert.ok(!/^status:/m.test(fs.readFileSync(activeItemPath(ctx), 'utf8')), 'fixture still declares a status');
  });

  scoped(/^the dropped-parcel sweep evaluates it$/, (ctx) => {
    runDroppedParcelSweep(ctx);
  });

  scoped(/^a dropped-parcel nudge is sent: "([^"]+)"$/, (ctx, verdict) => {
    if (!KNOWN_VERDICTS.has(verdict)) {
      throw new Error(`unknown <sent> token: ${verdict}`);
    }
    const nudges = droppedParcelNudges(ctx);
    if (verdict === 'yes') {
      assert.ok(nudges.length > 0, `expected a dropped-parcel nudge naming ${ITEM_ID}, sweep said: ${ctx.sweepOutput}`);
      assert.ok(
        nudges.some((c) => /^to: coordinator$/m.test(c)),
        `expected the nudge addressed to the coordinator, got: ${nudges.join('\n---\n')}`
      );
    } else {
      assert.equal(
        nudges.length,
        0,
        `expected no dropped-parcel nudge for ${ITEM_ID}, got: ${nudges.join('\n---\n')} (sweep said: ${ctx.sweepOutput})`
      );
    }
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────────
  scoped(/^the sweep log names the ticket and why it was suppressed$/, (ctx) => {
    const line = daemonLog(ctx)
      .split('\n')
      .find((l) => l.includes('dropped-parcel-suppressed') && l.includes(ITEM_ID));
    assert.ok(line, `expected a suppression line naming ${ITEM_ID} in the daemon log, got: ${daemonLog(ctx)}`);
    assert.match(line, /status: blocked/, `suppression line states no reason: ${line}`);
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────────
  scoped(/^an active ticket that declares status "blocked" and has never been dispatched$/, (ctx) => {
    writeActiveItem(ctx, 'blocked');
    // "never been dispatched" - remove the Background's trail entirely, so
    // this is the dispatch-gap sweep's own candidate shape.
    fs.rmSync(trailDir(ctx), { recursive: true, force: true });
  });

  scoped(/^the dispatch-gap sweep evaluates it$/, (ctx) => {
    ctx.dispatchGapOutput = execFileSync('bb', [DISPATCH_GAP_HARNESS, ctx.root], { encoding: 'utf8' });
  });

  scoped(/^a dispatch-gap nudge is sent: "([^"]+)"$/, (ctx, verdict) => {
    if (!KNOWN_VERDICTS.has(verdict)) {
      throw new Error(`unknown <sent> token: ${verdict}`);
    }
    const claimed = new RegExp(`GAPS: \\[[^\\]]*"${ITEM_ID}"`).test(ctx.dispatchGapOutput);
    assert.equal(
      claimed,
      verdict === 'yes',
      `expected dispatch-gap claim of ${ITEM_ID} to be ${verdict}, sweep said: ${ctx.dispatchGapOutput}`
    );
  });
}

module.exports = { registerSteps };
