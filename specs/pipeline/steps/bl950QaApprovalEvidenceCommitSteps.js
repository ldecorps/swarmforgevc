'use strict';

// BL-950: step handlers for "A QA approval names the commit QA made, never
// the bare commit it received". Drives the REAL swarm_handoff.bb (and its
// real review_forward_evidence_gate_lib.bb call chain) against a real
// fixture git repo - the same pattern as bl806ReviewForwardEvidenceGateSteps.js,
// which this gate extends.
//
// BL-1565 (2026-09-14) retired every QA-to-coordinator scenario this file
// used to drive (see the feature file's own header comment for why): a
// git_handoff naming the coordinator is refused before `validate` - and so
// before review_forward_evidence_gate_lib.bb - ever runs, so neither the
// "refused for Article 4.4 reasons" nor the "delivered" claims stay true.
// Only the non-approval-forward coverage (a bounce, a merge-up note)
// remains, and it needs no coordinator recipient or "aaaaaaaaaa"-family
// KNOWN_VALUES commit token at all - the fixture keeps a single real
// commit for the received/cited task instead.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');

const FEATURE = 'A QA approval names the commit QA made, never the bare commit it received';

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedRoots.push(root);
  return root;
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function roleDir(ctx, role) {
  return path.join(ctx.root, role);
}

function mailboxDir(ctx, role, state) {
  return path.join(roleDir(ctx, role), '.swarmforge', 'handoffs', 'inbox', state);
}

function writeRoles(ctx) {
  const rows = [
    `coder\tcoder-wt\t${roleDir(ctx, 'coder')}\tswarmforge-coder\tCoder\tclaude\ttask`,
    `cleaner\tcleaner-wt\t${roleDir(ctx, 'cleaner')}\tswarmforge-cleaner\tCleaner\tclaude\tbatch`,
    `architect\tarchitect-wt\t${roleDir(ctx, 'architect')}\tswarmforge-architect\tArchitect\tclaude\ttask`,
    `hardender\thardender-wt\t${roleDir(ctx, 'hardender')}\tswarmforge-hardender\tHardener\tclaude\tbatch`,
    `documenter\tdocumenter-wt\t${roleDir(ctx, 'documenter')}\tswarmforge-documenter\tDocumenter\tclaude\ttask`,
    `QA\tQA-wt\t${roleDir(ctx, 'QA')}\tswarmforge-QA\tQa\tclaude\ttask`,
  ];
  mkdirp(path.join(ctx.root, '.swarmforge'));
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
}

function mkFixture(ctx) {
  ctx.root = mkTmp('sfvc-bl950-');
  git(ctx.root, ['init', '-q']);
  git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'received work']);
  const received = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  for (const role of ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
    mkdirp(roleDir(ctx, role));
  }
  writeRoles(ctx);
  // The feature's commit-literal token, mapped to the real fixture commit
  // (KNOWN_VALUES - an unknown token throws, never a passthrough).
  ctx.commitTokens = { aaaaaaaaaa: received };
}

function knownCommit(ctx, token) {
  if (!Object.prototype.hasOwnProperty.call(ctx.commitTokens, token)) {
    throw new Error(`unknown commit token: ${token}`);
  }
  return ctx.commitTokens[token];
}

function seedQaInProcess(ctx, task, commit) {
  const dir = mailboxDir(ctx, 'QA', 'in_process');
  mkdirp(dir);
  const content = `id: x\nfrom: documenter\nto: QA\npriority: 20\ntype: git_handoff\nrole: documenter\ntask: ${task}\ncommit: ${commit}\ncreated_at: 2026-08-19T00:00:00Z\n\nbody\n`;
  fs.writeFileSync(path.join(dir, '00_received.handoff'), content);
}

function sendFromQa(ctx, draftContent) {
  const cwd = roleDir(ctx, 'QA');
  mkdirp(cwd);
  const draftPath = path.join(cwd, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, draftContent);
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: 'QA' },
  });
  ctx.result = { status: res.status, output: `${res.stdout || ''}\n${res.stderr || ''}` };
}

// Scenario 03's <send> column - each row builds and submits one real draft.
// KNOWN_VALUES: an unrecognized row throws rather than passing through.
const SEND_BUILDERS = {
  'a bounce git_handoff to the coder naming the same commit': (ctx, task) =>
    `type: git_handoff\nto: coder\npriority: 00\ntask: ${task}\ncommit: ${ctx.commitTokens.aaaaaaaaaa}\n`,
  'a merge-up note to the worktree roles': (ctx, task) =>
    `type: note\nto: coder,cleaner,architect,hardender,documenter\npriority: 00\nmessage: ${task} QA-approved ${ctx.commitTokens.aaaaaaaaaa} - merge up\n`,
};

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the handoff gate reads the commit a role received for a task from that role's own in-process mailbox$/,
    (ctx) => {
      mkFixture(ctx);
    },
    FEATURE
  );

  // ── Givens ───────────────────────────────────────────────────────────
  registry.defineScoped(
    /^QA received the parcel for task "([^"]+)" naming commit "([^"]+)"$/,
    (ctx, task, token) => {
      ctx.task = task;
      seedQaInProcess(ctx, task, knownCommit(ctx, token));
    },
    FEATURE
  );

  // ── Whens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^QA sends (.+) for task "([^"]+)"$/,
    (ctx, send, task) => {
      if (!Object.prototype.hasOwnProperty.call(SEND_BUILDERS, send)) {
        throw new Error(`unknown <send> token: ${send}`);
      }
      sendFromQa(ctx, SEND_BUILDERS[send](ctx, task));
    },
    FEATURE
  );

  // ── Thens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the send is delivered$/,
    (ctx) => {
      assert.notEqual(ctx.result.status, 2, `expected the send to be accepted, but it was refused:\n${ctx.result.output}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
