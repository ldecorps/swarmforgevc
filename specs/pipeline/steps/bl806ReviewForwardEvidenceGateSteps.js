'use strict';

// BL-806: step handlers for "a review role's forward must name its own pass
// commit, never the bare received hash". Drives the REAL swarm_handoff.bb
// (and its real review_forward_evidence_gate_lib.bb call chain) against a
// real fixture git repo - same pattern as bl760DuplicateChainGuardSteps.js.
// Every pipeline role's "worktree" here is a plain subdirectory of one
// shared repo (not a real `git worktree add`) - project-root resolution
// only needs `.swarmforge/roles.tsv` to exist at the enclosing repo root,
// which a subdirectory of the same repo already satisfies.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');

const FEATURE_NAME =
  "BL-806 a review role's forward must name its own pass commit, never the bare received hash";

const NEXT_FORWARD_STAGE = {
  coder: 'cleaner',
  cleaner: 'architect',
  architect: 'hardender',
  hardender: 'documenter',
  documenter: 'QA',
};

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

// Never {...process.env} - an explicit allowlist, never leak this box's own
// broader environment into a spawned bb subprocess.
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

function seedInProcessParcel(ctx, role, task, commit) {
  const dir = mailboxDir(ctx, role, 'in_process');
  mkdirp(dir);
  const content = `id: x\nfrom: specifier\nto: ${role}\npriority: 20\ntype: git_handoff\nrole: specifier\ntask: ${task}\ncommit: ${commit}\ncreated_at: 2026-08-15T00:00:00Z\n\nbody\n`;
  fs.writeFileSync(path.join(dir, '00_received.handoff'), content);
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
}

function runSwarmHandoff(ctx, draftContent, role) {
  const cwd = roleDir(ctx, role);
  mkdirp(cwd);
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

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.defineScoped(/^a fixture project root with role mailboxes and a git repository$/, (ctx) => {
    ctx.root = mkTmp('bl806-review-forward-');
    git(ctx.root, ['init', '-q']);
    git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    for (const role of ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
      mkdirp(roleDir(ctx, role));
    }
    writeRoles(ctx);
    ctx.receivedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  }, FEATURE_NAME);

  // ── Given: the sender's in_process box ──────────────────────────────────
  registry.defineScoped(
    /^the (\S+) in_process box holds a git_handoff for task "([^"]+)" naming the received commit$/,
    (ctx, role, task) => {
      seedInProcessParcel(ctx, role, task, ctx.receivedCommit);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the (\S+) in_process box holds no git_handoff for task "([^"]+)"$/,
    () => {
      // No-op: the fixture starts with an empty in_process box for every role.
    },
    FEATURE_NAME,
  );

  // ── Given: the draft (prepared, not yet submitted) ──────────────────────
  registry.defineScoped(
    /^a draft git_handoff from (\S+) to the next forward stage for task "([^"]+)" naming that same received commit$/,
    (ctx, role, task) => {
      const to = NEXT_FORWARD_STAGE[role];
      ctx.senderRole = role;
      ctx.recipientRole = to;
      ctx.draft = `type: git_handoff\nto: ${to}\npriority: 50\ntask: ${task}\ncommit: ${ctx.receivedCommit}\n`;
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^a draft git_handoff from (\S+) to the next forward stage for task "([^"]+)" naming a descendant commit of the received commit$/,
    (ctx, role, task) => {
      const to = NEXT_FORWARD_STAGE[role];
      const dir = roleDir(ctx, role);
      mkdirp(dir);
      fs.writeFileSync(path.join(dir, `${role}-evidence.txt`), `${role} pass evidence\n`);
      git(ctx.root, ['add', '-A']);
      git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `${role} pass evidence`]);
      const descendant = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
      ctx.senderRole = role;
      ctx.recipientRole = to;
      ctx.draft = `type: git_handoff\nto: ${to}\npriority: 50\ntask: ${task}\ncommit: ${descendant}\n`;
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^a draft git_handoff from (\S+) to an earlier stage for task "([^"]+)" naming that same received commit$/,
    (ctx, role, task) => {
      const to = 'cleaner';
      ctx.senderRole = role;
      ctx.recipientRole = to;
      ctx.draft = `type: git_handoff\nto: ${to}\npriority: 00\ntask: ${task}\ncommit: ${ctx.receivedCommit}\n`;
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^a draft git_handoff from (\S+) to the next forward stage for task "([^"]+)" naming that same received commit with a reroute_reason$/,
    (ctx, role, task) => {
      const to = NEXT_FORWARD_STAGE[role];
      ctx.senderRole = role;
      ctx.recipientRole = to;
      ctx.draft =
        `type: git_handoff\nto: ${to}\npriority: 50\ntask: ${task}\ncommit: ${ctx.receivedCommit}\n` +
        `reroute_reason: cannot act on this parcel, routing onward\n`;
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^a draft git_handoff from (\S+) to the next forward stage for task "([^"]+)" naming any valid commit$/,
    (ctx, role, task) => {
      const to = NEXT_FORWARD_STAGE[role];
      ctx.senderRole = role;
      ctx.recipientRole = to;
      ctx.draft = `type: git_handoff\nto: ${to}\npriority: 50\ntask: ${task}\ncommit: ${ctx.receivedCommit}\n`;
    },
    FEATURE_NAME,
  );

  // ── When ─────────────────────────────────────────────────────────────
  registry.defineScoped(/^the draft is submitted to swarm_handoff$/, (ctx) => {
    ctx.result = runSwarmHandoff(ctx, ctx.draft, ctx.senderRole);
  }, FEATURE_NAME);

  // ── Then ─────────────────────────────────────────────────────────────
  registry.defineScoped(/^the handoff is (refused|accepted)$/, (ctx, outcome) => {
    const out = combinedOutput(ctx.result);
    if (outcome === 'refused') {
      if (ctx.result.status !== 2) {
        throw new Error(`expected the handoff to be refused (exit 2), got exit ${ctx.result.status}: ${out}`);
      }
      if (!/HANDOFF INVALID/.test(out)) {
        throw new Error(`expected a HANDOFF INVALID report, got: ${out}`);
      }
    } else if (ctx.result.status === 2) {
      throw new Error(`expected the handoff to be accepted, but it was refused: ${out}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the refusal names Article 4\.4 pass evidence as the missing step$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes('4.4')) {
      throw new Error(`expected the refusal to name Article 4.4, got: ${out}`);
    }
    if (!/explicit-NONE evidence/.test(out)) {
      throw new Error(`expected the refusal to name explicit-NONE evidence, got: ${out}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^nothing is delivered to the recipient's inbox$/, (ctx) => {
    const files = listFiles(mailboxDir(ctx, ctx.recipientRole, 'new'));
    if (files.length !== 0) {
      throw new Error(`expected ${ctx.recipientRole}'s new/ to be empty, found: ${files.join(', ')}`);
    }
  }, FEATURE_NAME);
}

module.exports = { registerSteps };
