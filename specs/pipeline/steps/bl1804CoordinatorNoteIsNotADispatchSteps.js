'use strict';

// BL-1804: step handlers for "A note to the coordinator is never a
// dispatch". Reuses BL-1223's fixture shape (a throwaway git root, a flat
// coordinator+coder roles.tsv) for driving the REAL dispatch_trail_cli.bb
// (scenario 01) and route_backlog_to_coder.sh (scenario 02) end to end,
// plus a `bb -e` call into chase_sweep_lib.bb's own pure
// unassigned-active-items for scenario 03 - never a reimplementation of
// any of the three. Handler lands in the SAME commit as the feature
// (BL-233, BL-1371).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const DISPATCH_TRAIL_CLI = path.join(SCRIPTS_DIR, 'dispatch_trail_cli.bb');
const ROUTE_SH = path.join(SCRIPTS_DIR, 'route_backlog_to_coder.sh');
const CHASE_SWEEP_LIB = path.join(SCRIPTS_DIR, 'chase_sweep_lib.bb');
const FEATURE = 'BL-1804 A note to the coordinator is never a dispatch';

const TICKET_ID = 'BL-19804';

function mkTmp(prefix) {
  return trackedTmpRoot(prefix);
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkRoot(ctx) {
  if (ctx.bl1804?.root) return ctx.bl1804.root;
  const root = mkTmp('bl1804-');
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  mkdirp(path.join(root, 'backlog', 'active'));
  mkdirp(path.join(root, 'backlog', 'paused'));
  mkdirp(path.join(root, 'backlog', 'done'));
  mkdirp(path.join(root, 'swarmforge'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n` +
      `coder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`,
  );
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 50\n');
  ctx.bl1804 = { root };
  return root;
}

function writeActiveTicket(root, id) {
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', `${id}-fixture.yaml`),
    `id: ${id}\ntitle: "fixture"\nstatus: todo\nassigned_to:\n`,
  );
}

// Places one handoff file addressed to `to` into the coordinator's own
// new/ mailbox - dispatch_trail_cli.bb's scan-dirs-for reads every role's
// mailboxes (coordinator's included), and unassigned-active-items reads
// only pending-dirs the production caller passes it (coordinator's own
// new/in_process, mirrored here).
function writeCoordinatorMailboxHandoff(root, { to, type, task, message }) {
  const dir = path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new');
  mkdirp(dir);
  const lines = [`from: coordinator`, `to: ${to}`, `type: ${type}`, `priority: 00`];
  if (task) lines.push(`task: ${task}`);
  if (message) lines.push(`message: ${message}`);
  fs.writeFileSync(
    path.join(dir, `00_${Date.now()}_${Math.random().toString(36).slice(2)}.handoff`),
    `${lines.join('\n')}\n\n`,
  );
}

function runDispatchTrailCli(root, args) {
  const res = spawnSync('bb', [DISPATCH_TRAIL_CLI, root, ...args], { encoding: 'utf8', env: processEnvAllowlist() });
  return (res.stdout || '').trim();
}

function unassignedActiveNudgeMessage(id) {
  const script = `
(load-file "${CHASE_SWEEP_LIB}")
(println (chase-sweep-lib/unassigned-active-note-message "${id}"))
`;
  return execFileSync('bb', ['-e', script], { encoding: 'utf8', env: processEnvAllowlist() }).trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an active ticket with no assignee and no parcel in flight$/, (ctx) => {
    const root = mkRoot(ctx);
    writeActiveTicket(root, TICKET_ID);
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the only mailbox handoff naming it is a note to "(coder|specifier|coordinator)" reading "(.+)"$/, (ctx, to, header) => {
    const root = mkRoot(ctx);
    const message = header.replace(/BL-900/g, TICKET_ID);
    writeCoordinatorMailboxHandoff(root, { to, type: 'note', message });
  });

  scoped(/^the dispatch trail is asked whether that ticket was dispatched$/, (ctx) => {
    ctx.bl1804.answer = runDispatchTrailCli(ctx.bl1804.root, ['dispatched', TICKET_ID]);
  });

  scoped(/^the answer is "(DISPATCHED|UNDISPATCHED)"$/, (ctx, expected) => {
    assert.equal(ctx.bl1804.answer, expected, `dispatch_trail_cli.bb answered "${ctx.bl1804.answer}"`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the only mailbox handoff naming it is the sweep's unassigned nudge to the coordinator$/, (ctx) => {
    const root = mkRoot(ctx);
    const message = unassignedActiveNudgeMessage(TICKET_ID);
    writeCoordinatorMailboxHandoff(root, { to: 'coordinator', type: 'note', message });
  });

  scoped(/^the coordinator routes it with route_backlog_to_coder\.sh without --force$/, (ctx) => {
    const { root } = ctx.bl1804;
    const res = spawnSync('bash', [ROUTE_SH, TICKET_ID, root], {
      cwd: root,
      encoding: 'utf8',
      env: { ...processEnvAllowlist(), SWARMFORGE_SKIP_SYNC_INJECT: '1', SWARMFORGE_ROLE: 'coordinator' },
    });
    ctx.bl1804.routeResult = { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
  });

  scoped(/^a parcel is emitted for that ticket$/, (ctx) => {
    const { root, routeResult } = ctx.bl1804;
    const parcelCount = fs
      .readdirSync(path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'outbox'), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.handoff')).length;
    assert.ok(
      parcelCount > 0 && !/already has a dispatch trail/.test(routeResult.out),
      `expected a parcel to be emitted, got rc=${routeResult.status} out: ${routeResult.out}`,
    );
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the sweep's unassigned nudge for that ticket is waiting unread in the coordinator's inbox$/, (ctx) => {
    const root = mkRoot(ctx);
    const message = unassignedActiveNudgeMessage(TICKET_ID);
    writeCoordinatorMailboxHandoff(root, { to: 'coordinator', type: 'note', message });
  });

  scoped(/^the unassigned-active sweep runs$/, (ctx) => {
    const { root } = ctx.bl1804;
    const pendingDir = path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new');
    const script = `
(load-file "${CHASE_SWEEP_LIB}")
(require '[cheshire.core :as json])
(println (json/generate-string (mapv :id (chase-sweep-lib/unassigned-active-items "${path.join(root, 'backlog', 'active')}" ["${pendingDir}"]))))
`;
    const out = execFileSync('bb', ['-e', script], { encoding: 'utf8', env: processEnvAllowlist() });
    ctx.bl1804.sweepIds = JSON.parse(out.trim().split('\n').pop());
  });

  scoped(/^it sends no second nudge for that ticket$/, (ctx) => {
    assert.ok(
      !ctx.bl1804.sweepIds.includes(TICKET_ID),
      `expected no nudge for ${TICKET_ID}, got: ${JSON.stringify(ctx.bl1804.sweepIds)}`,
    );
  });
}

module.exports = { registerSteps };
