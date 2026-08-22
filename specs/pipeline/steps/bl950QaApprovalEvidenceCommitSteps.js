'use strict';

// BL-950: step handlers for "A QA approval names the commit QA made, never
// the bare commit it received". Drives the REAL swarm_handoff.bb (and its
// real review_forward_evidence_gate_lib.bb call chain) against a real
// fixture git repo - the same pattern as bl806ReviewForwardEvidenceGateSteps.js,
// which this gate extends. The feature's commit literals ("aaaaaaaaaa",
// "bbbbbbbbbb") are KNOWN_VALUES tokens mapped to REAL fixture commits -
// swarm_handoff.bb canonicalizes the commit header against the repo, so a
// literal placeholder hash would be refused for the wrong reason (commit
// resolution) and prove nothing about the gate.

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
  return role === 'coordinator' ? ctx.root : path.join(ctx.root, role);
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
    `coordinator\tmaster\t${roleDir(ctx, 'coordinator')}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
  ];
  mkdirp(path.join(ctx.root, '.swarmforge'));
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
}

function mkFixture(ctx) {
  ctx.root = mkTmp('sfvc-bl950-');
  git(ctx.root, ['init', '-q']);
  git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'received work']);
  const received = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'QA pass evidence']);
  const evidence = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  for (const role of ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
    mkdirp(roleDir(ctx, role));
  }
  writeRoles(ctx);
  // The feature's commit-literal tokens, mapped to the real fixture commits
  // (KNOWN_VALUES - an unknown token throws, never a passthrough).
  ctx.commitTokens = { aaaaaaaaaa: received, bbbbbbbbbb: evidence };
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
  'a git_handoff naming the same commit with a reroute_reason': (ctx, task) =>
    `type: git_handoff\nto: coordinator\npriority: 50\ntask: ${task}\ncommit: ${ctx.commitTokens.aaaaaaaaaa}\nreroute_reason: deliberate detour for the acceptance fixture\n`,
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

  registry.defineScoped(
    /^QA holds no in-process parcel for task "([^"]+)"$/,
    (ctx, task) => {
      ctx.task = task;
      // The fixture starts with an empty in_process box - nothing to seed.
    },
    FEATURE
  );

  // ── Whens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^QA sends an approval git_handoff to the coordinator naming commit "([^"]+)"$/,
    (ctx, token) => {
      sendFromQa(ctx, `type: git_handoff\nto: coordinator\npriority: 50\ntask: ${ctx.task}\ncommit: ${knownCommit(ctx, token)}\n`);
    },
    FEATURE
  );

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
    /^the send is refused$/,
    (ctx) => {
      assert.equal(ctx.result.status, 2, `expected a refusal (exit 2), got exit ${ctx.result.status}:\n${ctx.result.output}`);
      assert.match(ctx.result.output, /HANDOFF INVALID/);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the refusal names Article 4\.4 pass evidence$/,
    (ctx) => {
      assert.ok(ctx.result.output.includes('4.4'), `expected the refusal to name Article 4.4, got:\n${ctx.result.output}`);
      assert.match(ctx.result.output, /evidence/, `expected the refusal to name pass evidence, got:\n${ctx.result.output}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the send is delivered$/,
    (ctx) => {
      assert.notEqual(ctx.result.status, 2, `expected the send to be accepted, but it was refused:\n${ctx.result.output}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
