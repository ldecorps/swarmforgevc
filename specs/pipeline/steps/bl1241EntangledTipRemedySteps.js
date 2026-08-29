'use strict';

// BL-1241: step handlers for "an entangled tip at the land step has a
// remedy the swarm can actually reach". Drives the REAL land_step_cli.bb
// (land_step_lib.bb's detection + replay!) against a real git fixture -
// never a reimplementation of the detection or replay logic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LAND_STEP_CLI = path.join(SCRIPTS_DIR, 'land_step_cli.bb');
const FEATURE = 'An entangled tip at the land step has a remedy the swarm can actually reach';

const GIT_ID = ['-c', 'user.email=t@t', '-c', 'user.name=t'];
const TASK_NAME = 'BL-91020-fixture';
const TASK_TICKET_ID = 'BL-91020';
const SIBLING_TICKET_ID = 'BL-91021';

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitCommit(cwd, message) {
  git(cwd, [...GIT_ID, 'commit', '-q', '-m', message]);
}

function commitFile(root, relPath, content, message) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(root, ['add', '-A']);
  gitCommit(root, message);
}

function markOriginMainHere(root) {
  git(root, ['update-ref', 'refs/remotes/origin/main', gitOut(root, ['rev-parse', 'HEAD'])]);
}

function runLandStep(root, taskName, commit) {
  const res = spawnSync('bb', [LAND_STEP_CLI, taskName, commit, root], { encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function mkRoot(ctx) {
  if (ctx.bl1241?.root) return ctx.bl1241.root;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1241-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, [...GIT_ID, 'commit', '-q', '--allow-empty', '-m', 'seed']);
  markOriginMainHere(root);
  ctx.bl1241 = { root };
  return root;
}

// The ticket's own approval record - a plain YAML file this suite never
// touches itself, so scenario 04 can assert it survives byte-identical.
function writeApprovalRecord(root) {
  const p = path.join(root, 'backlog', 'active', `${TASK_TICKET_ID}-fixture.yaml`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const content = `id: ${TASK_TICKET_ID}\ntitle: "fixture"\nstatus: todo\nhuman_approval: approved\nassigned_to: coder\n`;
  fs.writeFileSync(p, content);
  return { path: p, content };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a parcel approved for its own ticket at the land step$/, (ctx) => {
    const root = mkRoot(ctx);
    ctx.bl1241.approval = writeApprovalRecord(root);
    git(root, ['add', '-A']);
    gitCommit(root, `${TASK_TICKET_ID}: seed approval record`);
    markOriginMainHere(root);
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^no other ticket's unlanded work is an ancestor of the commit$/, (ctx) => {
    const { root } = ctx.bl1241;
    commitFile(root, 'backlog/active/BL-91020-work.yaml', `id: ${TASK_TICKET_ID}\n`, `${TASK_TICKET_ID}: own work only`);
    ctx.bl1241.commit = gitOut(root, ['rev-parse', 'HEAD']);
  });

  scoped(/^the land step runs$/, (ctx) => {
    const { root, commit } = ctx.bl1241;
    ctx.bl1241.result = runLandStep(root, TASK_NAME, commit);
  });

  scoped(/^the commit is landed$/, (ctx) => {
    assert.match(ctx.bl1241.result.out, /^LAND_CLEAN /, ctx.bl1241.result.out);
    assert.equal(ctx.bl1241.result.status, 0, ctx.bl1241.result.out);
  });

  // ── Scenario 02 / shared entangled fixture ──────────────────────────
  scoped(/^another ticket's unlanded work is an ancestor of the commit$/, (ctx) => {
    const { root } = ctx.bl1241;
    commitFile(root, `backlog/active/${SIBLING_TICKET_ID}-work.yaml`, `id: ${SIBLING_TICKET_ID}\n`, `${SIBLING_TICKET_ID}: sibling unlanded work`);
    commitFile(root, 'backlog/active/BL-91020-work.yaml', `id: ${TASK_TICKET_ID}\n`, `${TASK_TICKET_ID}: own work`);
    ctx.bl1241.commit = gitOut(root, ['rev-parse', 'HEAD']);
  });

  scoped(/^the commit is not landed$/, (ctx) => {
    assert.doesNotMatch(ctx.bl1241.result.out, /^LAND_CLEAN /, ctx.bl1241.result.out);
  });

  scoped(/^the outcome names every sibling ticket whose work is entangled$/, (ctx) => {
    assert.match(ctx.bl1241.result.out, new RegExp(SIBLING_TICKET_ID), ctx.bl1241.result.out);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the outcome is not a bounce to the parcel's own author$/, (ctx) => {
    // Structural: land_step_cli.bb never emits a swarm_handoff.sh draft, a
    // `note` to the author, or anything addressed to a role at all - its
    // entire output is stdout for whoever INVOKED it (QA, per QA.prompt's
    // own BL-1241 section). Confirmed by construction: grep the tool's own
    // source for anything handoff-shaped, and confirm none of its output
    // text names an author-directed action.
    const src = fs.readFileSync(LAND_STEP_CLI, 'utf8');
    assert.doesNotMatch(src, /swarm_handoff/, 'land_step_cli.bb must never send a handoff itself - that stays QA\'s own call');
    assert.doesNotMatch(ctx.bl1241.result.out, /bounce/i, ctx.bl1241.result.out);
  });

  scoped(/^the outcome names an action that removes the entanglement$/, (ctx) => {
    const { out } = ctx.bl1241.result;
    // Either a completed replay (LAND_REPLAY names the ready-to-land
    // branch+commit QA lands instead) or, on the rarer escalate path, an
    // explicit reason - never a bare "refused" with nothing to act on.
    assert.ok(
      /^LAND_REPLAY /.test(out) || /^LAND_ESCALATE/.test(out),
      `expected either a replay result or an escalation reason, got: ${out}`,
    );
    if (/^LAND_REPLAY /.test(out)) {
      assert.match(out, /LAND_REPLAY \S+ \S+/, out);
    } else {
      assert.ok(out.split('\n').length > 1, `expected an escalation reason beyond the bare LAND_ESCALATE line, got: ${out}`);
    }
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the parcel has passed every quality gate for its own ticket$/, (ctx) => {
    mkRoot(ctx);
    // No-op beyond Background's own approval record - already written.
  });

  scoped(/^the parcel's own approval is still recorded$/, (ctx) => {
    const { approval } = ctx.bl1241;
    const after = fs.readFileSync(approval.path, 'utf8');
    assert.equal(after, approval.content, 'the land step must never touch the ticket\'s own approval record');
  });

  scoped(/^the parcel is not required to repeat the stages it already passed$/, (ctx) => {
    // Structural: land_step_cli.bb touches only git objects (a new branch
    // off origin/main) - it writes no backlog/*.yaml `status:`/
    // `required_stages:` field, so nothing routes the parcel back through
    // an earlier stage. Confirmed the same way as scenario 03: the tool's
    // own source never references required_stages or a stage-routing
    // concept at all.
    const src = fs.readFileSync(LAND_STEP_CLI, 'utf8');
    const libSrc = fs.readFileSync(path.join(SCRIPTS_DIR, 'land_step_lib.bb'), 'utf8');
    assert.doesNotMatch(src + libSrc, /required_stages|status:\s*todo|route_backlog/, 'the land step must never re-route a parcel through earlier stages');
  });
}

module.exports = { registerSteps };
