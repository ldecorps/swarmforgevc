'use strict';

// BL-1223: step handlers for "Only a message that dispatches work counts
// as a dispatch trail". Drives the REAL dispatch_trail_cli.bb (scenario 01),
// chase_sweep_lib.bb's dispatch-gap-items via a bb -e call (scenario 02),
// and the REAL route_backlog_to_coder.sh end to end (scenario 03) - the
// same fixture shape test_bl1097_router_refuses_dispatched_ticket.sh
// already establishes for driving that script against a throwaway project
// root, never a reimplementation of the CLI/router.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const DISPATCH_TRAIL_CLI = path.join(SCRIPTS_DIR, 'dispatch_trail_cli.bb');
const ROUTE_SH = path.join(SCRIPTS_DIR, 'route_backlog_to_coder.sh');
const CHASE_SWEEP_LIB = path.join(SCRIPTS_DIR, 'chase_sweep_lib.bb');
const FEATURE = 'Only a message that dispatches work counts as a dispatch trail';

const TICKET_ID = 'BL-19223';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

// A minimal fixture project root: git repo, coordinator (master) + coder
// roles.tsv (both pointed at ROOT itself - the same flat single-root shape
// test_bl1097_router_refuses_dispatched_ticket.sh uses), and the ticket's
// own active yaml.
function mkRoot(ctx) {
  if (ctx.bl1223?.root) return ctx.bl1223.root;
  const root = mkTmp('bl1223-');
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
  ctx.bl1223 = { root };
  return root;
}

function writeActiveTicket(root, id) {
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', `${id}-fixture.yaml`),
    `id: ${id}\ntitle: "fixture"\nstatus: todo\nassigned_to: coder\n`,
  );
}

// Places one handoff file naming the ticket into coordinator's sent/
// mailbox - one of chase_sweep_lib.bb/dispatch-trail-states, so
// dispatch_trail_cli.bb's own scan-dirs-for finds it regardless of which
// role "sent" it in this fixture.
function writeMailboxHandoff(root, { type, task, message }) {
  const dir = path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'sent');
  mkdirp(dir);
  const lines = [`from: coordinator`, `to: coder`, `type: ${type}`, `priority: 00`];
  if (task) lines.push(`task: ${task}`);
  if (message) lines.push(`message: ${message}`);
  fs.writeFileSync(path.join(dir, `00_${Date.now()}_${Math.random().toString(36).slice(2)}.handoff`), `${lines.join('\n')}\n\n`);
}

function runDispatchTrailCli(root, args) {
  const res = spawnSync('bb', [DISPATCH_TRAIL_CLI, root, ...args], { encoding: 'utf8', env: processEnvAllowlist() });
  return (res.stdout || '').trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an active ticket with no parcel in flight$/, (ctx) => {
    const root = mkRoot(ctx);
    writeActiveTicket(root, TICKET_ID);
  });

  scoped(/^the only mailbox handoff naming it has type (git_handoff|note) and header "(.+)"$/, (ctx, type, header) => {
    const root = mkRoot(ctx);
    const rendered = header.replace(/BL-900/g, TICKET_ID);
    if (type === 'git_handoff') {
      writeMailboxHandoff(root, { type, task: rendered });
    } else {
      writeMailboxHandoff(root, { type, message: rendered });
    }
  });

  scoped(/^the dispatch trail is asked whether that ticket was dispatched$/, (ctx) => {
    ctx.bl1223.answer = runDispatchTrailCli(ctx.bl1223.root, ['dispatched', TICKET_ID]);
  });

  scoped(/^the answer is (DISPATCHED|UNDISPATCHED)$/, (ctx, expected) => {
    assert.equal(ctx.bl1223.answer, expected, `dispatch_trail_cli.bb answered "${ctx.bl1223.answer}"`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the coordinator has sent a note reporting that the ticket has no parcel$/, (ctx) => {
    const root = mkRoot(ctx);
    const script = `
(load-file "${CHASE_SWEEP_LIB}")
(println (chase-sweep-lib/dropped-parcel-note-message "${TICKET_ID}"))
`;
    const message = execFileSync('bb', ['-e', script], { encoding: 'utf8', env: processEnvAllowlist() }).trim();
    writeMailboxHandoff(root, { type: 'note', message });
  });

  scoped(/^the dispatch-gap sweep lists the tickets needing a route$/, (ctx) => {
    const { root } = ctx.bl1223;
    const script = `
(load-file "${CHASE_SWEEP_LIB}")
(require '[cheshire.core :as json])
(def roles (handoff-lib/load-all-roles "${root}"))
(def scan-dirs (chase-sweep-lib/dispatch-trail-dirs roles))
(println (json/generate-string (mapv :id (chase-sweep-lib/dispatch-gap-items "${path.join(root, 'backlog', 'active')}" scan-dirs))))
`;
    const out = execFileSync('bb', ['-e', script], { encoding: 'utf8', env: processEnvAllowlist() });
    ctx.bl1223.gapIds = JSON.parse(out.trim().split('\n').pop());
  });

  scoped(/^that ticket is listed$/, (ctx) => {
    assert.ok(ctx.bl1223.gapIds.includes(TICKET_ID), `expected ${TICKET_ID} in the dispatch-gap list, got: ${JSON.stringify(ctx.bl1223.gapIds)}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a paused ticket whose only mailbox mention is a spec-ready note$/, (ctx) => {
    const root = mkRoot(ctx);
    fs.writeFileSync(
      path.join(root, 'backlog', 'paused', `${TICKET_ID}-fixture.yaml`),
      `id: ${TICKET_ID}\ntitle: "fixture"\nstatus: todo\nassigned_to: coder\n`,
    );
    writeMailboxHandoff(root, {
      type: 'note',
      message: `${TICKET_ID} ready in backlog/paused/ - human_approval pending`,
    });
  });

  scoped(/^the coordinator promotes and routes it$/, (ctx) => {
    const { root } = ctx.bl1223;
    // "Promotes": the coordinator's own move from paused/ to active/ - a
    // plain file move, exactly what promotion does to a ticket's own YAML;
    // this scenario is about the ROUTER, not the promotion-gate machinery.
    fs.renameSync(
      path.join(root, 'backlog', 'paused', `${TICKET_ID}-fixture.yaml`),
      path.join(root, 'backlog', 'active', `${TICKET_ID}-fixture.yaml`),
    );
    const res = spawnSync('bash', [ROUTE_SH, TICKET_ID, root], {
      cwd: root,
      encoding: 'utf8',
      env: { ...processEnvAllowlist(), SWARMFORGE_SKIP_SYNC_INJECT: '1', SWARMFORGE_ROLE: 'coordinator' },
    });
    ctx.bl1223.routeResult = { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
  });

  scoped(/^a parcel is emitted for that ticket$/, (ctx) => {
    const { root, routeResult } = ctx.bl1223;
    const parcelCount = fs
      .readdirSync(path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'outbox'), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.handoff')).length;
    assert.ok(
      parcelCount > 0 && !/already has a dispatch trail/.test(routeResult.out),
      `expected a parcel to be emitted, got rc=${routeResult.status} out: ${routeResult.out}`,
    );
  });
}

module.exports = { registerSteps };
