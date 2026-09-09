'use strict';

// BL-1466: step handlers for "a bounced sibling never rides another
// ticket's land until it is re-fixed". Drives the REAL
// swarmforge/scripts/land_step_lib.bb (land-plan, ticket-approval-state,
// bounce-blocking-state) against a fixture git repository with its own
// bounce store - never a reimplementation of the decision.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "BL-1466 A bounced sibling never rides another ticket's land until it is re-fixed";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const LANDING = 'BL-9001';
const SIBLING = 'BL-9002';
const SHARED_PATH = 'specs/pipeline/steps/index.js';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function head(root) {
  return git(root, 'rev-parse', 'HEAD');
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

function writeTicket(root, folder, id, approvalLine) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\nstatus: todo\n${approvalLine}`);
}

function writeBounce(root, ticket, commit, at) {
  const dir = path.join(root, '.swarmforge', 'bounces');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, '2026-09.jsonl'),
    JSON.stringify({ ticket, producingRole: 'coder', ticketType: 'defect', failureClass: 'behavior', commit, by: 'QA', at }) + '\n',
  );
}

// A durable completed-handoff record for `ticket` citing `commit` - the
// same shape salvage-lib/latest-item-handoffs reads back, so a "re-fix"
// is a real record, never a status field.
function recordHandoff(root, ticket, commit) {
  const rolesTsv = path.join(root, '.swarmforge', 'roles.tsv');
  if (!fs.existsSync(rolesTsv)) {
    fs.mkdirSync(path.dirname(rolesTsv), { recursive: true });
    fs.writeFileSync(rolesTsv, ['cleaner', 'cleaner', root, 'session', 'Cleaner', 'claude', 'task'].join('\t') + '\n');
  }
  const completedDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(completedDir, { recursive: true });
  fs.writeFileSync(
    path.join(completedDir, `00_${process.hrtime.bigint()}_from_documenter_to_qa_for_qa.handoff`),
    `task: ${ticket}-fixture\ncommit: ${commit}\nto: qa\nfrom: documenter\n`,
  );
}

function bb(expr) {
  const r = spawnSync('bb', ['-e', expr], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return r.stdout.trim().split('\n').pop();
}

function libExpr(body) {
  return `(require '[cheshire.core :as json])\n(load-file "${LAND_STEP_LIB}")\n${body}`;
}

function landPlan(root, commit) {
  return JSON.parse(bb(libExpr(
    `(println (json/generate-string (land-step-lib/land-plan {:root "${root}" :commit "${commit}" :task-ticket-id "${LANDING}"})))`,
  )));
}

function approvalState(root, ticketId, commit) {
  return JSON.parse(bb(libExpr(
    `(println (json/generate-string (land-step-lib/bounce-blocking-state "${root}" "${ticketId}" "${commit}")))`,
  )));
}

function bl1375State(root, ticketId) {
  return JSON.parse(bb(libExpr(
    `(println (json/generate-string (land-step-lib/ticket-approval-state "${root}" "${ticketId}")))`,
  )));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository with an origin, a main branch, a landing ticket, and an approved sibling ticket sharing a path with it$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1466-fixture-');
      git(root, 'init', '-q', '-b', 'main', '.');
      git(root, 'config', 'user.email', 't@t');
      git(root, 'config', 'user.name', 't');
      git(root, 'config', 'commit.gpgsign', 'false');
      fs.mkdirSync(path.join(root, 'specs', 'pipeline', 'steps'), { recursive: true });
      fs.writeFileSync(path.join(root, SHARED_PATH), '// base\n');
      git(root, 'add', '-A');
      git(root, 'commit', '-q', '-m', 'seed the step registry');
      git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

      writeTicket(root, 'active', SIBLING, 'human_approval: approved\n');
      commitFile(root, SHARED_PATH, '// base\n// landing line\n', `${LANDING}: the landing ticket adds its line`);
      commitFile(
        root, SHARED_PATH, '// base\n// landing line\n// sibling line\n',
        `${SIBLING}: the sibling adds its own line to the same file`,
      );

      ctx.root = root;
      ctx.siblingCommit = head(root);
    },
  );

  scoped(
    /^the sibling's most recent bounce record names a commit reachable from the landing tip and no later handoff of the sibling exists$/,
    (ctx) => {
      writeBounce(ctx.root, SIBLING, ctx.siblingCommit, '2026-09-07T11:48:00.000Z');
    },
  );

  scoped(
    /^the sibling's most recent bounce record is older than a later handoff of the sibling citing a descendant of the bounced commit$/,
    (ctx) => {
      writeBounce(ctx.root, SIBLING, ctx.siblingCommit, '2026-09-07T11:48:00.000Z');
      commitFile(ctx.root, `backlog/active/${SIBLING}-refix.txt`, 'refixed\n', `${SIBLING}: re-fix`);
      recordHandoff(ctx.root, SIBLING, head(ctx.root));
    },
  );

  scoped(/^the bounce store for the current month is unreadable$/, (ctx) => {
    const dir = path.join(ctx.root, '.swarmforge', 'bounces');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '2026-09.jsonl'), 'not valid json\n');
  });

  scoped(/^no bounce record names the sibling$/, () => {
    // The fixture already has no bounce store - nothing further to do.
  });

  scoped(/^the land step plans the landing ticket's tip$/, (ctx) => {
    ctx.tip = head(ctx.root);
    ctx.plan = landPlan(ctx.root, ctx.tip);
  });

  scoped(/^the sibling is reported as blocking, naming the bounce and its commit$/, (ctx) => {
    assert.equal(ctx.plan.action, 'escalate', `expected escalate, got: ${JSON.stringify(ctx.plan)}`);
    assert.ok(ctx.plan.reason.includes(SIBLING), `reason does not name the sibling: ${ctx.plan.reason}`);
    assert.ok(ctx.plan.reason.includes('bounced'), `reason does not name the bounce: ${ctx.plan.reason}`);
    assert.ok(ctx.plan.reason.includes(ctx.siblingCommit), `reason does not name the bounced commit: ${ctx.plan.reason}`);
  });

  scoped(/^no path the sibling owns rides the replay and the sibling is not a passenger$/, (ctx) => {
    assert.ok(!(ctx.plan.passengers || []).includes(SIBLING), `the bounced sibling rode as a passenger: ${JSON.stringify(ctx.plan)}`);
  });

  scoped(/^the sibling's approval state is approved and it may ride as a passenger as before$/, (ctx) => {
    assert.equal(ctx.plan.action, 'replay', `expected replay, got: ${JSON.stringify(ctx.plan)}`);
    assert.ok((ctx.plan.passengers || []).includes(SIBLING), `the re-fixed sibling did not ride: ${JSON.stringify(ctx.plan)}`);
    if (ctx.plan.branch) git(ctx.root, 'branch', '-q', '-D', ctx.plan.branch);
  });

  scoped(/^the sibling's approval state is unreadable and blocking, naming the store$/, (ctx) => {
    const state = approvalState(ctx.root, SIBLING, ctx.tip);
    assert.equal(state.state, 'unreadable', `expected unreadable, got: ${JSON.stringify(state)}`);
    assert.equal(state['blocking?'], true, `expected blocking, got: ${JSON.stringify(state)}`);
    assert.equal(ctx.plan.action, 'escalate', `expected the plan itself to escalate too: ${JSON.stringify(ctx.plan)}`);
  });

  scoped(/^the sibling's approval state is exactly what BL-1375 gives it$/, (ctx) => {
    const bounce = approvalState(ctx.root, SIBLING, ctx.tip);
    assert.equal(bounce, null, `expected no bounce concern, got: ${JSON.stringify(bounce)}`);
    const bl1375 = bl1375State(ctx.root, SIBLING);
    assert.equal(bl1375['blocking?'], false, `expected BL-1375's own answer (approved), got: ${JSON.stringify(bl1375)}`);
    assert.equal(ctx.plan.action, 'replay', `expected replay exactly as BL-1375 alone would decide: ${JSON.stringify(ctx.plan)}`);
    if (ctx.plan.branch) git(ctx.root, 'branch', '-q', '-D', ctx.plan.branch);
  });
}

module.exports = { registerSteps };
