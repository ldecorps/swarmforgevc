'use strict';

// BL-1576: step handlers for "a forward is refused when a merge on the
// sender's branch dropped one side's uncontested hunks". Drives the REAL
// swarm_handoff.bb (and its real merge_drop_guard_lib.bb call chain)
// against a real fixture git repo, same pattern as
// bl1213ParcelRollbackGuardSteps.js - a single shared git repo playing the
// role of "the branch" (git operations always target ctx.root), with each
// pipeline role given its OWN mailbox subdirectory (roleDir) so seeding one
// role's in_process parcel never collides with another role's mailbox.
//
// Merge commits are built with `git commit-tree` directly rather than
// through a real `git merge` (except the one scenario that specifically
// wants a real auto-merge) - this gives exact, deterministic control over
// what each scenario's merge resolution kept or dropped, regardless of
// whatever git's own merge heuristics would produce for a given content
// shape.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');

const TASK_NAME = 'BL-1576-fixture';
const TICKET_ID = 'BL-1576';
const FEATURE_NAME = "BL-1576 a forward is refused when a merge on the sender's branch dropped one side's uncontested hunks";
const PATH_NAME = 'shared.txt';

function mkTmp(prefix) {
  return mkSocketFixtureRoot(prefix);
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitTry(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// BL-1390: a fresh mkdtemp dir under mkSocketFixtureRoot - `git init` here
// can never touch the live checkout - proven right after init, BEFORE any
// mutating git command follows.
function proveFixtureIsolated(root) {
  const commonDir = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function roleDir(ctx, role) {
  return role === 'coordinator' ? ctx.root : path.join(ctx.root, role);
}

function writeRoles(ctx) {
  const rows = [
    `coder\tcoder-wt\t${roleDir(ctx, 'coder')}\tswarmforge-coder\tCoder\tclaude\ttask`,
    `cleaner\tcleaner-wt\t${roleDir(ctx, 'cleaner')}\tswarmforge-cleaner\tCleaner\tclaude\tbatch`,
    `architect\tarchitect-wt\t${roleDir(ctx, 'architect')}\tswarmforge-architect\tArchitect\tclaude\ttask`,
    `hardender\thardender-wt\t${roleDir(ctx, 'hardender')}\tswarmforge-hardender\tHardener\tclaude\tbatch`,
    `documenter\tdocumenter-wt\t${roleDir(ctx, 'documenter')}\tswarmforge-documenter\tDocumenter\tclaude\ttask`,
    `QA\tQA-wt\t${roleDir(ctx, 'QA')}\tswarmforge-QA\tQa\tclaude\ttask`,
    `coordinator\tmaster\t${roleDir(ctx, 'coordinator')}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
  ];
  fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
  for (const role of ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
    fs.mkdirSync(roleDir(ctx, role), { recursive: true });
  }
}

function writeFile(ctx, name, content) {
  fs.writeFileSync(path.join(ctx.root, name), content);
}

function commit(ctx, message) {
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
}

function head(ctx) {
  return gitOut(ctx.root, ['rev-parse', 'HEAD']);
}

function seedReceivedParcel(ctx, role, commitSha) {
  const dir = path.join(roleDir(ctx, role), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  const content = `id: x\nfrom: coder\nto: ${role}\npriority: 50\ntype: git_handoff\nrole: coder\ntask: ${TASK_NAME}\ncommit: ${commitSha}\ncreated_at: 2026-09-15T00:00:00Z\n\nbody\n`;
  fs.writeFileSync(path.join(dir, '00_received.handoff'), content);
}

function runSwarmHandoff(ctx, draftContent, role) {
  const cwd = roleDir(ctx, role);
  const draftPath = path.join(cwd, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, draftContent);
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: role },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

// ── the shared fixture content shapes (mirrors merge_drop_guard_lib_test_
//    runner.bb and the property runner's own fixture exactly, so a defect
//    caught in one is reproducible in the others) ─────────────────────────

const BASE_LINES = [
  'base-1', 'base-2', 'recv-remove-a', 'recv-remove-b', 'base-5', 'base-6',
  'send-remove', 'base-8', 'base-9', 'send-insert-anchor', 'base-11', 'base-12',
  'recv-insert-anchor', 'base-14',
];

const linesStr = (lines) => `${lines.join('\n')}\n`;

const BASE_CONTENT = linesStr(BASE_LINES);

const RECEIVED_CONTENT = linesStr([
  'base-1', 'base-2', 'base-5', 'base-6', 'send-remove', 'base-8', 'base-9',
  'send-insert-anchor', 'base-11', 'base-12', 'recv-insert-anchor', 'recv-add-x', 'base-14',
]);

const SENDER_CONTENT = linesStr([
  'base-1', 'base-2', 'recv-remove-a', 'recv-remove-b', 'base-5', 'base-6',
  'base-8', 'base-9', 'send-insert-anchor', 'send-add-y', 'base-11', 'base-12',
  'recv-insert-anchor', 'base-14',
]);

const CORRECT_MERGE_CONTENT = linesStr([
  'base-1', 'base-2', 'base-5', 'base-6', 'base-8', 'base-9',
  'send-insert-anchor', 'send-add-y', 'base-11', 'base-12',
  'recv-insert-anchor', 'recv-add-x', 'base-14',
]);

const CORRECT_MINUS_RECEIVED_ADD_CONTENT = linesStr([
  'base-1', 'base-2', 'base-5', 'base-6', 'base-8', 'base-9',
  'send-insert-anchor', 'send-add-y', 'base-11', 'base-12', 'recv-insert-anchor', 'base-14',
]);

// Builds the received-side and sender-side commits from a common base
// commit (both direct children of base, so `git merge-base` between them
// IS the base commit), leaving the sender-side branch checked out - the
// state every scenario's merge step starts from.
function buildDivergedSides(ctx) {
  ctx.root = mkTmp('bl1576-merge-drop-');
  git(ctx.root, ['init', '-q', '-b', 'main', '.']);
  proveFixtureIsolated(ctx.root);
  git(ctx.root, ['config', 'user.email', 'bl1576@example.com']);
  git(ctx.root, ['config', 'user.name', 'bl1576']);
  git(ctx.root, ['config', 'commit.gpgsign', 'false']);
  writeRoles(ctx);
  ctx.pathName = PATH_NAME;
  writeFile(ctx, ctx.pathName, BASE_CONTENT);
  commit(ctx, 'seed base');
  const baseSha = head(ctx);

  writeFile(ctx, ctx.pathName, RECEIVED_CONTENT);
  commit(ctx, `${TICKET_ID}-fixture: received side`);
  ctx.receivedFullSha = head(ctx);

  git(ctx.root, ['reset', '-q', '--hard', baseSha]);
  writeFile(ctx, ctx.pathName, SENDER_CONTENT);
  commit(ctx, `${TICKET_ID}-fixture: sender side`);
  ctx.senderFullSha = head(ctx);
}

// Builds a merge commit with parents [senderSha, receivedSha] and an
// EXACT tree content, via commit-tree - deterministic regardless of
// whatever git's own merge machinery would produce for this content
// shape, and moves `main` (and HEAD, since it was already checked out
// there) to it.
function buildManualMerge(ctx, content, message) {
  writeFile(ctx, ctx.pathName, content);
  git(ctx.root, ['add', '-A']);
  const treeSha = gitOut(ctx.root, ['write-tree']);
  const mergeSha = gitOut(ctx.root, ['commit-tree', treeSha, '-p', ctx.senderFullSha, '-p', ctx.receivedFullSha, '-m', message]);
  git(ctx.root, ['update-ref', 'refs/heads/main', mergeSha]);
  git(ctx.root, ['checkout', '-q', 'main']);
  ctx.mergeSha = mergeSha;
}

// The one scenario that wants a REAL git auto-merge, no manual override -
// the fixture's hunks are spaced apart (at least two unchanged lines
// between any two edits on different sides) specifically so this succeeds
// with no conflict.
function buildRealAutoMerge(ctx) {
  git(ctx.root, ['-c', 'user.email=bl1576@example.com', '-c', 'user.name=bl1576', 'merge', '--no-edit', ctx.receivedFullSha]);
  ctx.mergeSha = head(ctx);
}

function applyResolution(ctx, resolution) {
  switch (resolution) {
    case "keeping both sides' hunks":
      buildManualMerge(ctx, CORRECT_MERGE_CONTENT, 'Merge received into sender (kept both).');
      return;
    case "git's own clean auto-merge, no conflict raised":
      buildRealAutoMerge(ctx);
      return;
    case "taking the sender's side verbatim, so the received side's removed lines return":
      buildManualMerge(ctx, SENDER_CONTENT, 'Merge received into sender (kept sender verbatim).');
      return;
    case 'dropping a line the received side added':
      buildManualMerge(ctx, CORRECT_MINUS_RECEIVED_ADD_CONTENT, 'Merge received into sender (dropped recv-add-x).');
      return;
    case "taking the received side verbatim, so the sender side's added line is gone":
      buildManualMerge(ctx, RECEIVED_CONTENT, 'Merge received into sender (kept received verbatim).');
      return;
    default:
      throw new Error(`bl1576: unknown resolution "${resolution}"`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── Background ───────────────────────────────────────────────────────

  scoped(/^a fixture repository where a path was edited on two sides since their merge base$/, (ctx) => {
    ctx.pendingBackground = true;
  });

  scoped(/^the received parcel commit removed lines from that path on one side$/, (ctx) => {
    buildDivergedSides(ctx);
  });

  scoped(/^the sender's branch carries an adjacent edit to the same path on the other side$/, (ctx) => {
    // buildDivergedSides already built both sides and left the sender-side
    // branch checked out - nothing further to arrange here (mirrors
    // bl1213's own "structural fact, not a separate action" steps).
  });

  scoped(/^a role holding the received parcel commit in its in_process mailbox, ready to hand off$/, (ctx) => {
    ctx.senderRole = 'cleaner';
    seedReceivedParcel(ctx, ctx.senderRole, ctx.receivedFullSha);
  });

  // ── Scenario Outline 01, and the shared literal phrasing in 03/04/05 ───

  scoped(/^the sender merged the received commit and resolved the path by (.+)$/, (ctx, resolution) => {
    applyResolution(ctx, resolution);
  });

  // ── Scenario 02: a genuinely contested hunk ─────────────────────────────

  scoped(/^both sides rewrote the same base line of that path differently$/, (ctx) => {
    ctx.root = mkTmp('bl1576-contested-');
    git(ctx.root, ['init', '-q', '-b', 'main', '.']);
    proveFixtureIsolated(ctx.root);
    git(ctx.root, ['config', 'user.email', 'bl1576@example.com']);
    git(ctx.root, ['config', 'user.name', 'bl1576']);
    git(ctx.root, ['config', 'commit.gpgsign', 'false']);
    writeRoles(ctx);
    ctx.pathName = 'one.txt';
    writeFile(ctx, ctx.pathName, 'shared-line\n');
    commit(ctx, 'seed base');
    const baseSha = head(ctx);

    writeFile(ctx, ctx.pathName, 'received-rewrite\n');
    commit(ctx, `${TICKET_ID}-fixture: received rewrites the line`);
    ctx.receivedFullSha = head(ctx);

    git(ctx.root, ['reset', '-q', '--hard', baseSha]);
    writeFile(ctx, ctx.pathName, 'sender-rewrite\n');
    commit(ctx, `${TICKET_ID}-fixture: sender rewrites the line`);
    ctx.senderFullSha = head(ctx);

    ctx.senderRole = 'cleaner';
    seedReceivedParcel(ctx, ctx.senderRole, ctx.receivedFullSha);
  });

  scoped(/^the sender merged the received commit and resolved that line by keeping one side's rewrite$/, (ctx) => {
    buildManualMerge(ctx, 'received-rewrite\n', 'Merge received into sender (picked received rewrite for the contested line).');
  });

  // ── Scenario 04: a revert excuses it ────────────────────────────────────

  scoped(/^the sender's branch carries a git revert of the received parcel commit after that merge$/, (ctx) => {
    git(ctx.root, ['-c', 'user.email=bl1576@example.com', '-c', 'user.name=bl1576', 'commit', '--allow-empty', '-q', '-m',
      `Revert "${TICKET_ID}-fixture: received side"\n\nThis reverts commit ${ctx.receivedFullSha}.`]);
  });

  // ── Scenario 05: the recorded received commit cannot be read ──────────

  scoped(/^the received parcel commit recorded in the in_process mailbox cannot be read$/, (ctx) => {
    ctx.senderRole = 'cleaner';
    seedReceivedParcel(ctx, ctx.senderRole, 'deadbeef00');
  });

  // ── Scenario 06: no merge at all ────────────────────────────────────────

  scoped(/^the sender committed on top of the received commit without merging anything$/, (ctx) => {
    git(ctx.root, ['checkout', '-q', '-B', 'main', ctx.receivedFullSha]);
    writeFile(ctx, ctx.pathName, 'unrelated later work, no merge\n');
    commit(ctx, `${TICKET_ID}-fixture: plain forward, no merge`);
    ctx.senderRole = 'cleaner';
    seedReceivedParcel(ctx, ctx.senderRole, ctx.receivedFullSha);
  });

  // ── When ─────────────────────────────────────────────────────────────

  scoped(/^the role sends the git_handoff$/, (ctx) => {
    const tipSha = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
    const draft = `type: git_handoff\nto: architect\npriority: 50\ntask: ${TASK_NAME}\ncommit: ${tipSha}\n`;
    ctx.result = runSwarmHandoff(ctx, draft, ctx.senderRole);
  });

  scoped(/^the role sends a note instead of a git_handoff$/, (ctx) => {
    const draft = `type: note\nto: architect\npriority: 00\nmessage: checking in on ${TICKET_ID}\n`;
    ctx.result = runSwarmHandoff(ctx, draft, ctx.senderRole);
  });

  // ── Then ─────────────────────────────────────────────────────────────

  const GATE_MARKER = /a one-sided merge resolution discarded uncontested work/;

  scoped(/^the send is (refused|allowed)$/, (ctx, outcome) => {
    const out = combinedOutput(ctx.result);
    const thisGateRefused = GATE_MARKER.test(out);
    if (outcome === 'refused') {
      if (ctx.result.status !== 2) {
        throw new Error(`expected the send to be refused (exit 2), got exit ${ctx.result.status}: ${out}`);
      }
      if (!/HANDOFF INVALID/.test(out)) {
        throw new Error(`expected a HANDOFF INVALID report, got: ${out}`);
      }
      if (!thisGateRefused) {
        throw new Error(`expected BL-1576's own gate to have refused, got: ${out}`);
      }
    } else {
      if (thisGateRefused) {
        throw new Error(`expected the send to be allowed, but BL-1576's gate refused it: ${out}`);
      }
    }
  });

  scoped(/^the gate records no finding$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (GATE_MARKER.test(out)) {
      throw new Error(`expected no BL-1576 finding, got: ${out}`);
    }
  });

  scoped(/^the refusal names the merge commit$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes(ctx.mergeSha)) {
      throw new Error(`expected the refusal to name the merge commit ${ctx.mergeSha}, got: ${out}`);
    }
  });

  scoped(/^the refusal names the path$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes(ctx.pathName)) {
      throw new Error(`expected the refusal to name the path ${ctx.pathName}, got: ${out}`);
    }
  });

  scoped(/^the refusal says the received side's hunks were dropped$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!/received side's uncontested hunks/.test(out)) {
      throw new Error(`expected the refusal to say the received side's hunks were dropped, got: ${out}`);
    }
  });

  scoped(/^the refusal states the number of lines dropped$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!/dropped \d+ lines? of/.test(out)) {
      throw new Error(`expected the refusal to state a number of lines dropped, got: ${out}`);
    }
  });

  scoped(/^a warning names the ticket whose received commit could not be read$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!/MERGE_DROP WARNING/.test(out) || !out.includes(TICKET_ID)) {
      throw new Error(`expected a MERGE_DROP warning naming ${TICKET_ID}, got: ${out}`);
    }
  });
}

module.exports = { registerSteps };
