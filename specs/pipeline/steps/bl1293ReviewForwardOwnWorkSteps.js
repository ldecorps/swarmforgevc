'use strict';

// BL-1293: BL-806's gate compared commit IDENTITY, so a bare
// "Merge <received> into <role-branch>" - a new commit, and the shape this
// swarm produces at nearly every hop - passed while the review role authored
// nothing. The architect forwarded BL-1224 exactly that way and only a
// human-authored QA bounce caught it.
//
// Drives the REAL swarm_handoff.bb (and through it the real
// review_forward_evidence_gate_lib.bb / pre_qa_gate_gather_lib.bb call chain)
// against a real fixture git repo - never a re-implementation of the decision.
// Same fixture conventions as bl806ReviewForwardEvidenceGateSteps.js: every
// role's "worktree" is a plain subdirectory of one shared repo, which is all
// project-root resolution needs.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_HANDOFF = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.bb');

const FEATURE_NAME = "A review role's forward carries work that role actually did";

const SENDER = 'architect';
const RECIPIENT = 'hardender';
const TASK = 'BL-1224-a-parcel-that-passed-through';
const ROLE_BRANCH = 'swarmforge-architect';

// Scenario Outline values are validated against this map, never passed
// through: an Examples row this file does not know about must fail loudly
// rather than silently exercising nothing (engineering.prompt).
const SHAPES = {
  'is the received commit unchanged': 'receivedUnchanged',
  'is a merge introducing nothing of its own': 'emptyMerge',
  "carries the role's own evidence file": 'ownEvidence',
  "carries the role's own fix": 'ownFix',
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

// The four commit shapes, each built for real in the fixture repo.
function buildForwardedCommit(ctx, shapeKey) {
  const { root } = ctx;
  switch (shapeKey) {
    case 'receivedUnchanged':
      return ctx.receivedCommit;

    case 'emptyMerge': {
      // The BL-1224 shape exactly: a role branch carrying unrelated prior
      // content merges the received parcel. Two parents, a tree matching
      // NEITHER of them, and not one line the role authored.
      git(root, ['checkout', '-q', ROLE_BRANCH]);
      git(root, ['merge', '--no-ff', '-q', '-m',
        `Merge commit '${ctx.receivedCommit}' into ${ROLE_BRANCH} (${TASK} cleaner handoff)`,
        ctx.receivedCommit]);
      return gitOut(root, ['rev-parse', '--short=10', 'HEAD']);
    }

    case 'ownEvidence': {
      git(root, ['checkout', '-q', ROLE_BRANCH]);
      git(root, ['merge', '--no-ff', '-q', '-m', `Merge ${ctx.receivedCommit}`, ctx.receivedCommit]);
      mkdirp(path.join(root, 'backlog', 'evidence'));
      fs.writeFileSync(
        path.join(root, 'backlog', 'evidence', `${TASK}-architect.md`),
        'architect review pass: NONE - no defects found.\n',
      );
      return commitAll(root, `evidence(${TASK}): architect pass - NONE`);
    }

    case 'ownFix': {
      git(root, ['checkout', '-q', ROLE_BRANCH]);
      git(root, ['merge', '--no-ff', '-q', '-m', `Merge ${ctx.receivedCommit}`, ctx.receivedCommit]);
      fs.writeFileSync(path.join(root, 'parcel.txt'), 'the parcel\narchitect corrected a boundary\n');
      return commitAll(root, `fix(${TASK}): architect correction`);
    }

    default:
      throw new Error(`unknown commit shape key: ${shapeKey}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^a review role forwarding a parcel it received$/, (ctx) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1293-review-forward-'));
    ctx.bl1293 = { root };
    ctx.root = root;

    git(root, ['init', '-q', '-b', 'main']);
    // Repo-local, not --global: `git merge` writes a commit of its own and
    // needs an identity, and the swarm host may have none configured.
    git(root, ['config', 'user.email', 'fixture@example.com']);
    git(root, ['config', 'user.name', 'fixture']);
    fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
    commitAll(root, 'init');

    // The role branch carries unrelated prior content, so a later merge's
    // tree matches neither parent - the false-positive shape a naive
    // "empty first-parent diff" check would miss.
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
  });

  scoped(/^the forwarded commit (.+)$/, (ctx, shape) => {
    const shapeKey = SHAPES[shape];
    if (!shapeKey) {
      throw new Error(
        `unknown forwarded-commit shape "${shape}" - known: ${Object.keys(SHAPES).join(' | ')}`,
      );
    }
    ctx.bl1293.shape = shape;
    ctx.bl1293.commit = buildForwardedCommit(ctx, shapeKey);
  });

  scoped(/^a review role found no defect and committed its explicit NONE evidence$/, (ctx) => {
    ctx.bl1293.shape = "carries the role's own evidence file";
    ctx.bl1293.commit = buildForwardedCommit(ctx, 'ownEvidence');
  });

  scoped(/^a forward refused for carrying none of the role's own work$/, (ctx) => {
    ctx.bl1293.shape = 'is a merge introducing nothing of its own';
    ctx.bl1293.commit = buildForwardedCommit(ctx, 'emptyMerge');
    ctx.bl1293.result = runSwarmHandoff(ctx, ctx.bl1293.commit);
    if (ctx.bl1293.result.status === 0) {
      throw new Error(`expected the empty merge to be refused, got:\n${ctx.bl1293.result.output}`);
    }
  });

  scoped(/^the review-forward evidence gate decides$/, (ctx) => {
    ctx.bl1293.result = runSwarmHandoff(ctx, ctx.bl1293.commit);
  });

  scoped(/^the refusal is read$/, (ctx) => {
    ctx.bl1293.refusal = ctx.bl1293.result.output;
  });

  scoped(/^the forward is (.+)$/, (ctx, verdict) => {
    if (!VERDICTS[verdict]) {
      throw new Error(`unknown verdict "${verdict}" - known: ${Object.keys(VERDICTS).join(' | ')}`);
    }
    const { status, output } = ctx.bl1293.result;
    if (verdict === 'refused') {
      if (status === 0) {
        throw new Error(`expected "${ctx.bl1293.shape}" to be REFUSED, but the send succeeded:\n${output}`);
      }
      // The refusal must be THIS gate's, not some other guard tripping - a
      // pass-by-coincidence would make every row of this outline vacuous.
      if (!/Article 4.4/.test(output) || !new RegExp(TASK).test(output)) {
        throw new Error(`refused, but not by the review-forward evidence gate:\n${output}`);
      }
      return;
    }
    if (status !== 0) {
      throw new Error(`expected "${ctx.bl1293.shape}" to be ALLOWED, but the send was refused:\n${output}`);
    }
  });

  scoped(/^it names the role, the task, and the evidence the role must commit$/, (ctx) => {
    const refusal = ctx.bl1293.refusal;
    for (const [what, needle] of [
      ['the role', SENDER],
      ['the task', TASK],
      ['the evidence directory to commit into', 'backlog/evidence/'],
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
