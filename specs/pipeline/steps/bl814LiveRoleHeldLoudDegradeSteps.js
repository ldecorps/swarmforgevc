'use strict';

// BL-814: step handlers for "a live role-held computation that did not run
// is distinguishable from one that found nothing". Drives the REAL
// readLiveRoleHeldTickets (telegram-front-desk-bot.ts), which itself shells
// to the REAL pipeline_stage_cli.bb `report` subprocess against an isolated
// fixture root - never mocked. Mirrors bl487BoardFreshnessWithoutCoordinator
// SyncSteps.js's own copy-the-real-scripts fixture technique; this feature
// is the direct-return-value contract that BL-487's own feature exercises
// indirectly through the rendered board.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const { readLiveRoleHeldTickets, RoleHeldTicketsComputationFailedError } = require(path.join(EXT_OUT, 'tools', 'telegram-front-desk-bot'));

const FEATURE = 'a live role-held computation that did not run is distinguishable from one that found nothing';

// The full, minimal set of load-file dependencies pipeline_stage_cli.bb's
// `report` actually needs to run - kept in sync with the sibling fixtures
// in extension/test/readLiveRoleHeldTicketsCli.test.js and
// bl487BoardFreshnessWithoutCoordinatorSyncSteps.js.
const REQUIRED_SCRIPT_FILES = ['pipeline_stage_cli.bb', 'pipeline_stage_lib.bb', 'handoff_lib.bb', 'ambulance_lib.bb', 'mono_router_lib.bb'];

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function copyScripts(scriptsDir, omit) {
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of REQUIRED_SCRIPT_FILES) {
    if (name === omit) {
      continue;
    }
    fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, name), path.join(scriptsDir, name));
  }
}

function writeRolesTsv(root, worktreePath, role) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), [role, role, worktreePath, 'session', role, 'claude'].join('\t') + '\n');
}

function writeActiveTicket(root, id) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: "fixture ticket"\n`);
}

function writeInProcessHandoff(worktreePath, role, taskName) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '00_fixture.handoff'),
    `id: fixture\nfrom: architect\nto: ${role}\nrecipient: ${role}\npriority: 00\ntype: git_handoff\nrole: architect\ncommit: 0000000000\ntask: ${taskName}\n\nRe-read your role and constitution.\n`
  );
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  scoped(registry, /^a fixture tree carrying the real pipeline stage scripts$/, (ctx) => {
    ctx.bl814 = { fixtureRoot: mkTmp('bl814-loud-degrade-') };
  });

  // ── shared Given steps ───────────────────────────────────────────────
  scoped(registry, /^the fixture carries every load-file dependency the real scripts need$/, (ctx) => {
    const scriptsDir = path.join(ctx.bl814.fixtureRoot, 'swarmforge', 'scripts');
    copyScripts(scriptsDir);
  });

  scoped(registry, /^the fixture is missing the load-file dependency (\S+)$/, (ctx, missingDependency) => {
    const scriptsDir = path.join(ctx.bl814.fixtureRoot, 'swarmforge', 'scripts');
    copyScripts(scriptsDir, missingDependency);
  });

  scoped(registry, /^role "([^"]+)" holds active ticket "([^"]+)" in its in_process mailbox$/, (ctx, role, ticketId) => {
    const { fixtureRoot } = ctx.bl814;
    const worktree = path.join(fixtureRoot, `${role}-worktree`);
    writeRolesTsv(fixtureRoot, worktree, role);
    writeActiveTicket(fixtureRoot, ticketId);
    writeInProcessHandoff(worktree, role, `${ticketId}-loud-degrade-fixture`);
  });

  scoped(registry, /^a stale ticket-stage-map cache names "([^"]+)" for "([^"]+)"$/, (ctx, staleRole, ticketId) => {
    const dir = path.join(ctx.bl814.fixtureRoot, '.swarmforge', 'board');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ticket-stage-map.json'), JSON.stringify({ [ticketId]: staleRole }));
  });

  scoped(registry, /^no role holds an active ticket in its in_process mailbox$/, () => {
    // Deliberate no-op: no roles.tsv, no backlog/active ticket, no
    // in_process handoff written - the genuinely-empty case.
  });

  // ── When ─────────────────────────────────────────────────────────────
  scoped(registry, /^the live role-held tickets are read$/, async (ctx) => {
    try {
      ctx.bl814.result = await readLiveRoleHeldTickets(ctx.bl814.fixtureRoot);
      ctx.bl814.failure = undefined;
    } catch (err) {
      ctx.bl814.result = undefined;
      ctx.bl814.failure = err;
    }
  });

  // ── Then ─────────────────────────────────────────────────────────────
  scoped(registry, /^the result reports "([^"]+)" holding "([^"]+)"$/, (ctx, role, ticketId) => {
    const { result, failure } = ctx.bl814;
    assert.equal(failure, undefined, `expected no failure, got: ${failure && failure.message}`);
    assert.deepEqual(result, { [role]: [ticketId] });
  });

  scoped(registry, /^the failure is surfaced to the caller$/, (ctx) => {
    const { failure } = ctx.bl814;
    assert.ok(failure instanceof RoleHeldTicketsComputationFailedError, `expected a RoleHeldTicketsComputationFailedError, got: ${failure}`);
  });

  scoped(registry, /^the result is not reported as an ordinary empty map$/, (ctx) => {
    const { result, failure } = ctx.bl814;
    assert.notEqual(failure, undefined, 'expected a failure to have been surfaced');
    assert.equal(result, undefined, 'expected no result value alongside a surfaced failure - a bare {} is exactly the forbidden shape');
  });

  scoped(registry, /^the result is an empty map$/, (ctx) => {
    const { result, failure } = ctx.bl814;
    assert.equal(failure, undefined, `expected no failure, got: ${failure && failure.message}`);
    assert.deepEqual(result, {});
  });

  scoped(registry, /^no failure is surfaced to the caller$/, (ctx) => {
    assert.equal(ctx.bl814.failure, undefined, `expected no failure, got: ${ctx.bl814.failure && ctx.bl814.failure.message}`);
  });
}

module.exports = { registerSteps };
