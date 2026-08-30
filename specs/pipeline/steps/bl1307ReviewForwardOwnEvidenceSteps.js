'use strict';

// BL-1307: BL-806 refuses a forward naming the received commit, and BL-1293
// refuses a merge that introduces nothing over its parents. Both judge the
// COMMIT; neither asks whether the ROLE produced anything. The architect's
// BL-1224 forward (b7d22b9ee3) resolved a real conflict in
// specs/pipeline/steps/index.js, so it contributes content of its own and
// passes both, while carrying no BL-1224 review output at all.
//
// Drives the REAL swarm_handoff.bb (and through it the real
// review_forward_evidence_gate_lib.bb call chain) against a real fixture git
// repo - never a re-implementation of the decision. Same fixture conventions
// as bl1293ReviewForwardOwnWorkSteps.js: every role's "worktree" is a plain
// subdirectory of one shared repo, which is all project-root resolution needs.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_HANDOFF = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.bb');

const FEATURE_NAME = "A review role's forward adds evidence that role authored";

const SENDER = 'architect';
const RECIPIENT = 'hardender';
const TASK = 'BL-1224-a-parcel-that-passed-through';
const TICKET = 'BL-1224';
const OTHER_TICKET = 'BL-9999';
const ROLE_BRANCH = 'swarmforge-architect';

// Scenario Outline values are validated against this map, never passed
// through: an Examples row this file does not know about must fail loudly
// rather than silently exercising nothing (engineering.prompt).
const SHAPES = {
  'add an evidence file naming this task': 'ownEvidence',
  'add an explicit committed NONE for this task': 'ownNone',
  'resolve a conflict and add no evidence for this task': 'conflictOnly',
  'add only an evidence file naming a different task': 'otherTaskEvidence',
};

const VERDICTS = {
  refused: 'refused',
  allowed: 'allowed',
};

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  return gitOut(root, ['rev-parse', '--short=10', 'HEAD']);
}

// Never {...process.env} - an explicit allowlist, so this box's own
// environment (an ambient GIT_DIR above all) never reaches the spawned bb.
function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function roleDir(ctx, role) {
  return role === 'coordinator' ? ctx.root : path.join(ctx.root, role);
}

function writeRoles(ctx) {
  const rows = [
    ['coder', 'Coder', 'task'],
    ['cleaner', 'Cleaner', 'batch'],
    ['architect', 'Architect', 'task'],
    ['hardender', 'Hardener', 'batch'],
    ['documenter', 'Documenter', 'task'],
    ['QA', 'Qa', 'task'],
  ].map(([role, label, mode]) =>
    `${role}\t${role}-wt\t${roleDir(ctx, role)}\tswarmforge-${role}\t${label}\tclaude\t${mode}`);
  rows.push(`coordinator\tmaster\t${ctx.root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`);
  mkdirp(path.join(ctx.root, '.swarmforge'));
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
}

function seedReceivedParcel(ctx) {
  const dir = path.join(roleDir(ctx, SENDER), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  mkdirp(dir);
  fs.writeFileSync(
    path.join(dir, '00_received.handoff'),
    `id: x\nfrom: cleaner\nto: ${SENDER}\npriority: 50\ntype: git_handoff\nrole: cleaner\n` +
      `task: ${TASK}\ncommit: ${ctx.receivedCommit}\ncreated_at: 2026-08-30T00:00:00Z\n\nbody\n`,
  );
}

function buildFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1307-review-forward-'));
  ctx.bl1307 = { root };
  ctx.root = root;

  git(root, ['init', '-q', '-b', 'main']);
  // Repo-local, not --global: `git merge` writes a commit of its own and
  // needs an identity, and the swarm host may have none configured.
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'fixture']);
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  commitAll(root, 'init');

  // The role branch carries unrelated prior content and its own edit to the
  // file the parcel also touches, so merging the parcel produces a REAL
  // conflict resolution - the b7d22b9ee3 shape, which contributes content of
  // its own and so passes both older gates.
  git(root, ['checkout', '-q', '-b', ROLE_BRANCH]);
  fs.writeFileSync(path.join(root, 'architect-prior.txt'), 'unrelated prior content\n');
  commitAll(root, 'prior architect content');

  git(root, ['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(root, 'parcel.txt'), 'the parcel\n');
  ctx.receivedCommit = commitAll(root, 'cleaner parcel');

  for (const role of ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
    mkdirp(roleDir(ctx, role));
  }
  writeRoles(ctx);
  seedReceivedParcel(ctx);
}

function mergeReceived(ctx) {
  git(ctx.root, ['checkout', '-q', ROLE_BRANCH]);
  git(ctx.root, ['merge', '--no-ff', '-q', '-m', `Merge ${ctx.receivedCommit}`, ctx.receivedCommit]);
}

function writeEvidence(ctx, ticket, body) {
  const dir = path.join(ctx.root, 'backlog', 'evidence');
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, `${ticket}-architect-20260830.md`), body);
}

// Each shape is built for real in the fixture repo. Every one of them
// contributes content of its own over the received commit, so BL-806's
// identity check and BL-1293's contribution check pass all four - only the
// evidence fact can explain a refusal here.
function buildForwardedCommit(ctx, shapeKey) {
  const { root } = ctx;
  mergeReceived(ctx);
  switch (shapeKey) {
    case 'ownEvidence':
      writeEvidence(ctx, TICKET, 'D1: boundary named in the wrong layer. Sent back.\n');
      return commitAll(root, `evidence(${TASK}): architect pass`);

    case 'ownNone':
      writeEvidence(ctx, TICKET, 'NONE - clean sweep, no defects found.\n');
      return commitAll(root, `evidence(${TASK}): architect pass - NONE`);

    case 'conflictOnly':
      // The BL-1224 shape: real content of the role's own (a resolved
      // conflict in a shared file) and no review output at all.
      fs.writeFileSync(
        path.join(root, 'parcel.txt'),
        'the parcel\nconflict resolved by the architect while merging\n',
      );
      return commitAll(root, `merge conflict resolution for ${TASK}`);

    case 'otherTaskEvidence':
      // A batch role's other in-process ticket: real evidence, wrong task.
      writeEvidence(ctx, OTHER_TICKET, 'NONE - clean sweep for a different ticket.\n');
      return commitAll(root, `evidence(${OTHER_TICKET}-another-parcel): architect pass - NONE`);

    default:
      throw new Error(`unknown commit shape key: ${shapeKey}`);
  }
}

function runSwarmHandoff(ctx, commit) {
  const cwd = roleDir(ctx, SENDER);
  mkdirp(cwd);
  const draftPath = path.join(cwd, `draft-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(
    draftPath,
    `type: git_handoff\nto: ${RECIPIENT}\npriority: 50\ntask: ${TASK}\ncommit: ${commit}\n`,
  );
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: SENDER },
  });
  return {
    status: res.status,
    output: `${res.stdout || ''}\n${res.stderr || ''}`,
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^a review role forwarding a parcel it received for a task$/, (ctx) => {
    buildFixture(ctx);
  });

  scoped(/^the commits from received to forwarded (.+)$/, (ctx, shape) => {
    const shapeKey = SHAPES[shape];
    if (!shapeKey) {
      throw new Error(
        `unknown range shape "${shape}" - known: ${Object.keys(SHAPES).join(' | ')}`,
      );
    }
    ctx.bl1307.shape = shape;
    ctx.bl1307.commit = buildForwardedCommit(ctx, shapeKey);
  });

  scoped(/^the architect's forward resolved a conflict but committed no BL-1224 evidence$/, (ctx) => {
    ctx.bl1307.shape = 'resolve a conflict and add no evidence for this task';
    ctx.bl1307.commit = buildForwardedCommit(ctx, 'conflictOnly');
  });

  // The fail-open half (invariant 2), driven through the real CLI: the
  // sender's in_process box holds no parcel for this task, so there is no
  // received commit to measure the range from and the gate cannot read what
  // the forward added. An absent fact must never stall a legitimate send.
  scoped(/^the gate cannot read what the forward added$/, (ctx) => {
    ctx.bl1307.shape = 'the range cannot be read';
    ctx.bl1307.commit = buildForwardedCommit(ctx, 'conflictOnly');
    const parcel = path.join(
      roleDir(ctx, SENDER), '.swarmforge', 'handoffs', 'inbox', 'in_process', '00_received.handoff',
    );
    fs.rmSync(parcel);
  });

  scoped(/^the review-forward evidence gate decides$/, (ctx) => {
    ctx.bl1307.result = runSwarmHandoff(ctx, ctx.bl1307.commit);
  });

  scoped(/^the forward is (.+)$/, (ctx, verdict) => {
    if (!VERDICTS[verdict]) {
      throw new Error(`unknown verdict "${verdict}" - known: ${Object.keys(VERDICTS).join(' | ')}`);
    }
    const { status, output } = ctx.bl1307.result;
    if (verdict === 'refused') {
      if (status === 0) {
        throw new Error(`expected "${ctx.bl1307.shape}" to be REFUSED, but the send succeeded:\n${output}`);
      }
      // The refusal must be THIS gate's, and specifically its evidence
      // branch - a pass-by-coincidence would make every row vacuous.
      if (!/Article 4.4/.test(output) || !output.includes('review evidence')) {
        throw new Error(`refused, but not by the review-forward evidence gate:\n${output}`);
      }
      return;
    }
    if (status !== 0) {
      throw new Error(`expected "${ctx.bl1307.shape}" to be ALLOWED, but the send was refused:\n${output}`);
    }
  });

  scoped(/^the refusal names the role, the task, and the evidence file to commit$/, (ctx) => {
    const refusal = ctx.bl1307.result.output;
    for (const [what, needle] of [
      ['the role', SENDER],
      ['the task', TASK],
      ['the evidence directory to commit into', 'backlog/evidence/'],
      ['the ticket id the filename must carry', TICKET],
      ['that an explicit NONE is a legitimate pass', 'NONE'],
      ['the governing article', '4.4'],
      ['the reroute_reason way out', 'reroute_reason'],
    ]) {
      if (!refusal.includes(needle)) {
        throw new Error(`refusal does not name ${what} ("${needle}"):\n${refusal}`);
      }
    }
  });
}

module.exports = { registerSteps, SHAPES, VERDICTS };
