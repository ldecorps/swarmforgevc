'use strict';

// BL-760: step handlers for "one ticket travels the pipeline as one live
// parcel". Drives the REAL swarm_handoff.bb (and its real
// duplicate_chain_guard_lib.bb call chain) against a real fixture git repo,
// same pattern as bl531PreQaDurabilityWiringGateSteps.js. Every pipeline
// role's "worktree" here is a plain subdirectory of one shared repo (not a
// real `git worktree add`) - project-root resolution only needs
// `.swarmforge/roles.tsv` to exist at the enclosing repo root, which a
// subdirectory of the same repo already satisfies, so no ticket in this
// feature depends on real worktree separation.
//
// defineScoped, pinned to this feature's own title: "the handoff is sent"/
// "the handoff is refused" are generic phrasing already used verbatim by
// other tickets' step files for unrelated behavior (BL-425's own documented
// collision shape) - scoping keeps this file's registration from winning
// resolution for a different feature's identical step text.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');

const TICKET_ID = 'BL-901';
const FEATURE_NAME = 'one ticket travels the pipeline as one live parcel';

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

function writeTicketYaml(ctx) {
  mkdirp(path.join(ctx.root, 'backlog', 'active'));
  fs.writeFileSync(
    path.join(ctx.root, 'backlog', 'active', `${TICKET_ID}-fixture.yaml`),
    `id: ${TICKET_ID}\ntitle: fixture ticket\nstatus: active\n`,
  );
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `seed ${TICKET_ID}`]);
}

// Writes a synthetic .handoff parcel straight into role's mailbox - the
// same "write the mailbox file directly" fixture pattern
// ticket_close_guard_lib_test_runner.bb's own write-architect-handoff! and
// test_ticket_close_guard.sh use, rather than round-tripping through a real
// send (this file exists to hold a parcel steady while a DIFFERENT send is
// exercised against it).
function seedParcel(ctx, role, state, filename, task) {
  const dir = mailboxDir(ctx, role, state);
  mkdirp(dir);
  const content = `id: x\nfrom: specifier\nto: ${role}\npriority: 20\ntype: git_handoff\nrole: specifier\ntask: ${task}\ncommit: ${ctx.citedCommit}\ncreated_at: 2026-07-31T00:00:00Z\n\nbody\n`;
  fs.writeFileSync(path.join(dir, filename), content);
  return filename;
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
  registry.defineScoped(/^a SwarmForge project whose pipeline roles each have their own mailbox$/, (ctx) => {
    ctx.root = mkTmp('bl760-dup-chain-');
    git(ctx.root, ['init', '-q']);
    git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    for (const role of ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
      mkdirp(roleDir(ctx, role));
    }
    writeRoles(ctx);
  }, FEATURE_NAME);

  registry.defineScoped(/^fixture ticket BL-901 is in backlog\/active\/$/, (ctx) => {
    writeTicketYaml(ctx);
    ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  }, FEATURE_NAME);

  // ── Given: a role's mailbox holds a live git_handoff for a ticket ───────
  registry.defineScoped(
    /^the (\S+)'s (new|in_process|completed) mailbox holds a git_handoff for task "([^"]+)"$/,
    (ctx, role, state, task) => {
      const filename = `20_${state}_blocker.handoff`;
      seedParcel(ctx, role, state, filename, task);
      ctx.blockingRole = role;
      ctx.blockingFilename = filename;
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the (\S+)'s in_process mailbox holds the git_handoff for task "([^"]+)" it is working$/,
    (ctx, role, task) => {
      seedParcel(ctx, role, 'in_process', '00_own_inbound.handoff', task);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(/^no other role holds a live parcel for BL-901$/, () => {
    // No-op: the fixture starts with no other seeded parcels for this ticket.
  }, FEATURE_NAME);

  // ── When ─────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the (\S+) runs swarm_handoff\.sh on a git_handoff draft for task "([^"]+)" addressed to (\S+)$/,
    (ctx, sender, task, to) => {
      ctx.senderRole = sender;
      const draft = `type: git_handoff\nto: ${to}\npriority: 50\ntask: ${task}\ncommit: ${ctx.citedCommit}\n`;
      ctx.result = runSwarmHandoff(ctx, draft, sender);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the (\S+) runs swarm_handoff\.sh on a note draft about (\S+) addressed to (\S+)$/,
    (ctx, sender, ticket, to) => {
      ctx.senderRole = sender;
      const draft = `type: note\nto: ${to}\npriority: 00\nmessage: checking in on ${ticket}\n`;
      ctx.result = runSwarmHandoff(ctx, draft, sender);
    },
    FEATURE_NAME,
  );

  // ── Then ─────────────────────────────────────────────────────────────
  registry.defineScoped(/^the handoff is (refused|sent)$/, (ctx, outcome) => {
    const out = combinedOutput(ctx.result);
    if (outcome === 'refused') {
      if (ctx.result.status !== 2) {
        throw new Error(`expected the handoff to be refused (exit 2), got exit ${ctx.result.status}: ${out}`);
      }
      if (!/HANDOFF INVALID/.test(out)) {
        throw new Error(`expected a HANDOFF INVALID report, got: ${out}`);
      }
    } else {
      if (ctx.result.status === 2) {
        throw new Error(`expected the handoff to be sent, but it was refused: ${out}`);
      }
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the coder's outbox and sent mailboxes are unchanged$/, (ctx) => {
    const outboxDir = path.join(roleDir(ctx, 'coder'), '.swarmforge', 'handoffs', 'outbox');
    const sentDir = path.join(roleDir(ctx, 'coder'), '.swarmforge', 'handoffs', 'sent');
    const outboxFiles = listFiles(outboxDir);
    const sentFiles = listFiles(sentDir);
    if (outboxFiles.length !== 0) {
      throw new Error(`expected coder's outbox to be empty, found: ${outboxFiles.join(', ')}`);
    }
    if (sentFiles.length !== 0) {
      throw new Error(`expected coder's sent to be empty, found: ${sentFiles.join(', ')}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the cleaner's mailbox receives no parcel$/, (ctx) => {
    const files = listFiles(mailboxDir(ctx, 'cleaner', 'new'));
    if (files.length !== 0) {
      throw new Error(`expected cleaner's new/ to be empty, found: ${files.join(', ')}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^no wake is injected into any session$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (/HANDOFF (DELIVERED|QUEUED)/.test(out)) {
      throw new Error(`expected no delivery/queue attempt to have been reached, got: ${out}`);
    }
    const injectLog = path.join(ctx.root, '.swarmforge', 'handoffs', 'inject-traffic.log');
    if (fs.existsSync(injectLog)) {
      throw new Error('expected no inject-traffic.log to have been written for a refused send');
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the refusal names the ticket, the documenter, and the blocking parcel filename$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes(TICKET_ID)) {
      throw new Error(`expected the refusal to name ${TICKET_ID}, got: ${out}`);
    }
    if (!out.includes('documenter')) {
      throw new Error(`expected the refusal to name documenter, got: ${out}`);
    }
    if (!out.includes(ctx.blockingFilename)) {
      throw new Error(`expected the refusal to name the blocking filename ${ctx.blockingFilename}, got: ${out}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the refusal names the command that abandons a genuinely stale parcel$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes('redo_from.sh')) {
      throw new Error(`expected the refusal to name redo_from.sh, got: ${out}`);
    }
  }, FEATURE_NAME);
}

module.exports = { registerSteps };
