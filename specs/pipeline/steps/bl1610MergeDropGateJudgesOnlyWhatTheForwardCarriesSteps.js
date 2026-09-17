'use strict';

// BL-1610: step handlers for "the merge-drop gate judges only the merges
// the sender made and only what the forward carries". Drives the REAL
// swarm_handoff.bb (its real merge_drop_guard_lib.bb call chain) against a
// real fixture git repo, same pattern as bl1576MergeDropGuardSteps.js -
// this file's own fixture content shapes are deliberately the SAME two
// diverging-sides/one-sided-merge shape (spaced-apart hunks so parse-hunks
// finds exactly one uncontested hunk per side), built TWICE: once before
// receipt (the historical drop this ticket exists to excuse), once after
// (the drop that must still refuse).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');
const MERGE_DROP_LIB = path.join(SCRIPTS_DIR, 'merge_drop_guard_lib.bb');

const TASK_NAME = 'BL-1610-fixture';
const FEATURE_NAME =
  'BL-1610 The merge-drop gate judges only the merges the sender made and only what the forward carries';
const P_PATH = 'p.txt';
const OTHER_PATH = 'other.txt';
const Q_PATH = 'q.txt';

function mkTmp(prefix) {
  return mkSocketFixtureRoot(prefix);
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

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

function writeRoles(ctx) {
  const coderDir = path.join(ctx.root, 'coder');
  const rows = [`coder\tcoder-wt\t${coderDir}\tswarmforge-coder\tCoder\tclaude\ttask`];
  fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
  fs.mkdirSync(coderDir, { recursive: true });
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

// The same spaced-apart-hunks content shape bl1576MergeDropGuardSteps.js
// proved produces exactly one uncontested hunk per side - reused with a
// `round` suffix so a second divergence (the "since" merge) never collides
// with the first (the "historical" merge) on the same lines.
function linesFor(round) {
  const base = [
    `${round}-1`, `${round}-2`, `${round}-recv-remove-a`, `${round}-recv-remove-b`, `${round}-5`, `${round}-6`,
    `${round}-send-remove`, `${round}-8`, `${round}-9`, `${round}-send-insert-anchor`, `${round}-11`, `${round}-12`,
    `${round}-recv-insert-anchor`, `${round}-14`,
  ];
  const received = [
    `${round}-1`, `${round}-2`, `${round}-5`, `${round}-6`, `${round}-send-remove`, `${round}-8`, `${round}-9`,
    `${round}-send-insert-anchor`, `${round}-11`, `${round}-12`, `${round}-recv-insert-anchor`, `${round}-recv-add-x`, `${round}-14`,
  ];
  const sender = [
    `${round}-1`, `${round}-2`, `${round}-recv-remove-a`, `${round}-recv-remove-b`, `${round}-5`, `${round}-6`,
    `${round}-8`, `${round}-9`, `${round}-send-insert-anchor`, `${round}-send-add-y`, `${round}-11`, `${round}-12`,
    `${round}-recv-insert-anchor`, `${round}-14`,
  ];
  const lines = (arr) => `${arr.join('\n')}\n`;
  return { base: lines(base), received: lines(received), sender: lines(sender) };
}

// Builds a one-sided merge (parents [senderSha, receivedSha], content =
// sender's side verbatim - taking sender verbatim drops the received
// side's uncontested hunks, exactly BL-1576's own "taking the sender's
// side verbatim" resolution shape) on top of a fresh divergence from
// `fromSha` on P_PATH. Leaves the merge checked out.
function buildOneSidedMergeSince(ctx, fromSha, round, targetPath = P_PATH) {
  const { base, received, sender } = linesFor(round);
  git(ctx.root, ['checkout', '-q', '-B', 'coder', fromSha]);
  writeFile(ctx, targetPath, base);
  commit(ctx, `${round} base`);
  const baseSha = head(ctx);

  git(ctx.root, ['checkout', '-q', '-b', `${round}-received`, baseSha]);
  writeFile(ctx, targetPath, received);
  commit(ctx, `${round} received side`);
  const receivedSideSha = head(ctx);

  git(ctx.root, ['checkout', '-q', 'coder']);
  writeFile(ctx, targetPath, sender);
  commit(ctx, `${round} sender side`);
  const senderSideSha = head(ctx);

  writeFile(ctx, targetPath, sender); // sender verbatim - drops the received side's hunk
  git(ctx.root, ['add', '-A']);
  const treeSha = gitOut(ctx.root, ['write-tree']);
  const mergeSha = gitOut(ctx.root, [
    'commit-tree', treeSha, '-p', senderSideSha, '-p', receivedSideSha, '-m', `${round} one-sided merge`,
  ]);
  git(ctx.root, ['update-ref', 'refs/heads/coder', mergeSha]);
  git(ctx.root, ['checkout', '-q', 'coder']);
  return { mergeSha, receivedSideSha };
}

// Row 5 (amended 2026-09-17): the SIBLING itself makes a one-sided merge
// that drops uncontested hunks on Q_PATH, BEFORE the coder ever receives
// anything - the dropping merge sits in the RECEIVED commit's own
// ancestry, never in anything "the coder made since receipt". Rebuilds
// 'coder' fresh off main's tip (discarding this scenario row's own
// historical P_PATH merge, irrelevant to this row) so the dropping merge
// is deliberately NOT a descendant of ctx.historicalMergeSha (the fixed
// received_at_head stamp every row shares) - proving the fix excludes it
// via `received`, never merely because `head` happens to dominate it.
function buildSiblingOwnDroppingMerge(ctx) {
  const { mergeSha } = buildOneSidedMergeSince(ctx, ctx.mainTipSha, 'sibdrop', Q_PATH);
  return mergeSha;
}

function buildBackground(ctx) {
  ctx.root = mkTmp('bl1610-merge-drop-');
  git(ctx.root, ['init', '-q', '-b', 'main', '.']);
  proveFixtureIsolated(ctx.root);
  git(ctx.root, ['config', 'user.email', 'bl1610@example.com']);
  git(ctx.root, ['config', 'user.name', 'bl1610']);
  git(ctx.root, ['config', 'commit.gpgsign', 'false']);
  writeRoles(ctx);
  writeFile(ctx, P_PATH, 'seed\n');
  writeFile(ctx, OTHER_PATH, 'seed\n');
  commit(ctx, 'seed base');
  ctx.mainTipSha = head(ctx);

  // A sibling branch off main, before receipt - the sibling side of the
  // historical one-sided merge.
  git(ctx.root, ['checkout', '-q', '-b', 'sibling']);

  // The historical merge - built BEFORE receipt, on 'coder' branching off
  // main's tip.
  const { mergeSha: historicalSha, receivedSideSha: siblingTipSha } = buildOneSidedMergeSince(
    ctx,
    ctx.mainTipSha,
    'hist'
  );
  ctx.historicalMergeSha = historicalSha;
  ctx.siblingTipSha = siblingTipSha;
  ctx.receivedAtHead = gitOut(ctx.root, ['rev-parse', '--short=10', ctx.historicalMergeSha]);
}

function seedReceivedParcel(ctx, receivedCommit) {
  const dir = path.join(ctx.root, 'coder', '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  const content =
    `id: x\nfrom: coordinator\nto: coder\npriority: 00\ntype: git_handoff\nrole: coordinator\ntask: ${TASK_NAME}\n` +
    `commit: ${receivedCommit}\nreceived_at_head: ${ctx.receivedAtHead}\ncreated_at: 2026-09-16T00:00:00Z\n\nbody\n`;
  fs.writeFileSync(path.join(dir, '00_received.handoff'), content);
}

function runSwarmHandoff(ctx, draftContent) {
  const cwd = path.join(ctx.root, 'coder');
  const draftPath = path.join(cwd, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, draftContent);
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: 'coder' },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

const GATE_MARKER = /a one-sided merge resolution discarded uncontested work/;

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a fixture repository with a main branch, a coder branch that merged main and a sibling branch several times before the parcel, and a coder role whose mailbox holds the received parcel$/,
    (ctx) => {
      buildBackground(ctx);
    }
  );

  // ── Scenario 01 (Outline) ────────────────────────────────────────────

  scoped(/^the received parcel's commit is (.+)$/, (ctx, received) => {
    if (received === "main's tip, the coordinator's route commit") {
      ctx.bl1610Received = gitOut(ctx.root, ['rev-parse', '--short=10', ctx.mainTipSha]);
    } else if (
      received ===
      'the sibling branch\'s tip, after the sibling itself made a one-sided merge that dropped uncontested hunks on a second path'
    ) {
      const mergeSha = buildSiblingOwnDroppingMerge(ctx);
      ctx.bl1610Received = gitOut(ctx.root, ['rev-parse', '--short=10', mergeSha]);
    } else {
      ctx.bl1610Received = gitOut(ctx.root, ['rev-parse', '--short=10', ctx.siblingTipSha]);
    }
  });

  scoped(/^the coder branch carries a one-sided merge from before the parcel that dropped uncontested hunks on a path$/, () => {
    // buildBackground already built this (ctx.historicalMergeSha) - a
    // structural fact of the fixture, nothing further to arrange.
  });

  scoped(/^after receipt the coder made (.+)$/, (ctx, since) => {
    if (since === 'a plain commit on another path') {
      writeFile(ctx, OTHER_PATH, 'coder touched another path after receipt\n');
      commit(ctx, 'plain commit on another path');
      ctx.bl1610SinceMerge = false;
    } else if (since === "a merge that dropped the sibling's uncontested hunks on a path") {
      const { mergeSha } = buildOneSidedMergeSince(ctx, ctx.historicalMergeSha, 'since');
      ctx.bl1610SinceMergeSha = mergeSha;
      ctx.bl1610SinceMerge = true;
    } else if (since === 'a plain commit on that second path') {
      const current = fs.readFileSync(path.join(ctx.root, Q_PATH), 'utf8');
      writeFile(ctx, Q_PATH, `${current}coder touched the second path after receipt\n`);
      commit(ctx, 'plain commit on the second path');
      ctx.bl1610SinceMerge = false;
    } else {
      throw new Error(`bl1610: unknown "since" shape "${since}"`);
    }
  });

  scoped(/^the forwarded commit (.+)$/, (ctx, forward) => {
    if (forward === 'changes nothing on the dropped path') {
      // no-op: HEAD already carries the since step's own result.
    } else if (forward === 'changes that path against the received commit') {
      const current = fs.readFileSync(path.join(ctx.root, P_PATH), 'utf8');
      writeFile(ctx, P_PATH, `${current}forward-changed-the-path\n`);
      commit(ctx, 'forward changes the dropped path further');
    } else if (forward === 'leaves that path identical to the received commit') {
      const receivedBlob = gitOut(ctx.root, ['show', `${ctx.bl1610Received}:${P_PATH}`]);
      writeFile(ctx, P_PATH, `${receivedBlob}\n`);
      commit(ctx, 'forward restores the dropped path to the received blob');
    } else if (forward === 'changes that second path against the received commit') {
      const current = fs.readFileSync(path.join(ctx.root, Q_PATH), 'utf8');
      writeFile(ctx, Q_PATH, `${current}forward-changed-the-second-path\n`);
      commit(ctx, 'forward changes the second path further');
    } else {
      throw new Error(`bl1610: unknown "forward" shape "${forward}"`);
    }
  });

  scoped(/^the coder sends a git_handoff for the parcel$/, (ctx) => {
    seedReceivedParcel(ctx, ctx.bl1610Received);
    const tipSha = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
    const draft = `type: git_handoff\nto: architect\npriority: 50\ntask: ${TASK_NAME}\ncommit: ${tipSha}\n`;
    ctx.bl1610Result = runSwarmHandoff(ctx, draft);
  });

  scoped(/^the send is (.+)$/, (ctx, outcome) => {
    const out = combinedOutput(ctx.bl1610Result);
    const refused = GATE_MARKER.test(out);
    if (outcome === 'queued with no merge-drop finding') {
      assert.ok(!refused, `expected no merge-drop finding, got: ${out}`);
    } else if (outcome === 'refused naming that merge, that path and the dropped lines') {
      assert.ok(refused, `expected a merge-drop refusal, got: ${out}`);
      assert.ok(out.includes(ctx.bl1610SinceMergeSha), `expected the refusal to name the since-merge ${ctx.bl1610SinceMergeSha}: ${out}`);
      assert.ok(out.includes(P_PATH), `expected the refusal to name ${P_PATH}: ${out}`);
      assert.match(out, /dropped \d+ lines? of/, `expected the refusal to state a number of lines dropped: ${out}`);
    } else if (outcome === 'queued, the finding excused as carrying nothing') {
      assert.ok(!refused, `expected the finding to be excused (not blocking), got: ${out}`);
    } else {
      throw new Error(`bl1610: unknown outcome "${outcome}"`);
    }
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────

  scoped(
    /^the gate is asked about a received commit on main and a forwarded commit with no merge of the sender's since receipt and every implicated path unchanged against the received commit$/,
    (ctx) => {
      // The historical merge predates receipt; the head stamp bounds the
      // scan to head..forwarded, and nothing was made after receipt - the
      // exact BL-1606 shape this ticket opened on, now fixed.
      const res = spawnSync('bb', [
        MERGE_DROP_LIB,
        ctx.root,
        gitOut(ctx.root, ['rev-parse', ctx.mainTipSha]),
        gitOut(ctx.root, ['rev-parse', 'HEAD']),
        gitOut(ctx.root, ['rev-parse', ctx.historicalMergeSha]),
      ], { encoding: 'utf8' });
      ctx.bl1610CliResult = res;
    }
  );

  scoped(/^it reports no finding$/, (ctx) => {
    const out = `${ctx.bl1610CliResult.stdout}${ctx.bl1610CliResult.stderr}`;
    assert.equal(ctx.bl1610CliResult.status, 0, `expected the CLI to exit 0: ${out}`);
    assert.equal(ctx.bl1610CliResult.stdout.trim(), '', `expected no finding lines, got: ${out}`);
  });
}

module.exports = { registerSteps };
