'use strict';

// BL-992: step handlers for "a declaration the sender has not merged is
// still read". Drives the REAL swarm_handoff.bb over the BL-951 fixture
// recipe (git root + roles.tsv + SWARMFORGE_REQUIRED_STAGES_ROUTING=1 +
// SWARMFORGE_SKIP_SYNC_INJECT=1), with the one twist this ticket is
// about: the declaration is COMMITTED to the fixture's main ref and then
// deleted from the working tree, so only the ref-based lookup can see it.
// Scenario 03 builds a root whose branch is deliberately NOT main (no
// resolvable main ref - the fallback path); scenario 04 a root where the
// ticket exists nowhere; scenario 05 the BL-900/BL-9005 exact-id guard
// against the ref.
//
// Invariant 1 (BL-968) applies: module load is requires and pure
// constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'A declaration the sender has not merged is still read';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_HANDOFF = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.bb');

// KNOWN_VALUES: the declaration tokens scenarios name.
const DECLARATIONS = {
  'coder-qa': 'required_stages: [coder, qa]\n',
  // A PRESENT, list-shaped declaration resolve-effective rejects (QA
  // omitted while coder is present) - required_stages_lib's own named
  // rejection, same probe value BL-951 uses.
  invalid: 'required_stages: [coder, cleaner]\n',
};
const KNOWN_ROLES = new Set(['cleaner', 'QA']);

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
}

function mkFixture(ctx, { branch = 'main' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl992-'));
  ctx.root = root;
  git(root, ['init', '-q']);
  git(root, ['branch', '-M', branch]);
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'features', 'x.feature'), 'Feature: x\n');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const rows = ['coordinator', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']
    .map((r) => `${r}\t${r === 'coordinator' ? 'master' : r}\t${root}\tswarmforge-${r}\tX\tclaude\ttask`)
    .join('\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${rows}\n`);
  ctx.ticketId = 'BL-901';
  ctx.task = 'BL-901-probe';
}

function ticketBody(id, declaration) {
  return `id: ${id}\ntitle: "probe"\nstatus: active\nacceptance: specs/features/x.feature\n${declaration}`;
}

function commitTicket(ctx, id, declaration) {
  const p = path.join(ctx.root, 'backlog', 'active', `${id}-probe.yaml`);
  fs.writeFileSync(p, ticketBody(id, declaration));
  git(ctx.root, ['add', '-A']);
  // Message carries NO ticket id: the BL-953 task-commit coherence gate
  // matches ids in commit subjects, and scenario 05 cites this commit for
  // a DIFFERENT ticket on purpose.
  git(ctx.root, ['commit', '-q', '-m', 'promote probe ticket']);
  ctx.commit = git(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  return p;
}

function send(ctx, { from, to, task }) {
  ctx.commit = ctx.commit || git(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  const draft = path.join(ctx.root, 'draft.txt');
  fs.writeFileSync(draft, `type: git_handoff\nto: ${to}\npriority: 50\ntask: ${task || ctx.task}\ncommit: ${ctx.commit}\n`);
  const res = spawnSync('bb', [SWARM_HANDOFF, 'draft.txt'], {
    cwd: ctx.root,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      SWARMFORGE_ROLE: from,
      SWARMFORGE_SKIP_SYNC_INJECT: '1',
      SWARMFORGE_REQUIRED_STAGES_ROUTING: '1',
    },
  });
  ctx.sendStatus = res.status;
  ctx.sendOut = `${res.stdout || ''}${res.stderr || ''}`;
  const outbox = path.join(ctx.root, '.swarmforge', 'handoffs', 'outbox');
  const files = fs.existsSync(outbox) ? fs.readdirSync(outbox).filter((f) => f.endsWith('.handoff')) : [];
  ctx.envelope = files.length ? fs.readFileSync(path.join(outbox, files[files.length - 1]), 'utf8') : '';
}

function assertDeliveredOnlyTo(ctx, role) {
  try {
    assert.equal(ctx.sendStatus, 0, `send must succeed:\n${ctx.sendOut}`);
    const toLine = ctx.envelope.split('\n').find((l) => l.startsWith('to: '));
    assert.equal(toLine, `to: ${role}`, `expected delivery to ${role} only, envelope:\n${ctx.envelope}`);
  } finally {
    cleanup(ctx);
  }
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = null;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^required_stages routing is enabled$/, (ctx) => {
    ctx.bl992 = true; // routing enabled per-send via env in send()
  });

  scoped(/^the ticket's committed declaration is required_stages (\S+)$/, (ctx, token) => {
    const declaration = DECLARATIONS[token];
    if (!declaration) {
      throw new Error(`unknown declaration token: ${token}`);
    }
    mkFixture(ctx);
    ctx.committedPath = commitTicket(ctx, ctx.ticketId, declaration);
  });
  scoped(/^the sender's working tree has no copy of the ticket$/, (ctx) => {
    fs.rmSync(ctx.committedPath);
    assert.ok(!fs.existsSync(ctx.committedPath), 'the working-tree copy must be gone');
  });

  scoped(/^no main ref resolves in the sender's root$/, (ctx) => {
    mkFixture(ctx, { branch: 'trunk' });
  });
  scoped(/^the sender's working tree declares required_stages (\S+)$/, (ctx, token) => {
    const declaration = DECLARATIONS[token];
    if (!declaration) {
      throw new Error(`unknown declaration token: ${token}`);
    }
    // Working tree ONLY - never committed, so only the fallback can see it.
    fs.writeFileSync(path.join(ctx.root, 'backlog', 'active', `${ctx.ticketId}-probe.yaml`), ticketBody(ctx.ticketId, declaration));
  });

  scoped(/^the ticket is absent from every ref and from the working tree$/, (ctx) => {
    mkFixture(ctx);
  });

  scoped(/^the ref carries a ticket "([^"]+)" declaring required_stages (\S+)$/, (ctx, id, token) => {
    const declaration = DECLARATIONS[token];
    if (!declaration) {
      throw new Error(`unknown declaration token: ${token}`);
    }
    mkFixture(ctx);
    const p = commitTicket(ctx, id, declaration);
    // Committed only - deleted from the working tree so the REF lookup is
    // the only place it exists (the collision must be ref-vs-ref).
    fs.rmSync(p);
  });
  scoped(/^the ref carries no ticket "([^"]+)"$/, (ctx, id) => {
    const listed = git(ctx.root, ['ls-tree', '-r', '--name-only', 'main', '--', 'backlog/active']);
    assert.ok(!listed.includes(`${id}-`), `precondition: ${id} must not be on the ref: ${listed}`);
  });

  scoped(/^the coder sends a git_handoff addressed to (\S+)$/, (ctx, to) => {
    if (!KNOWN_ROLES.has(to)) {
      throw new Error(`unknown recipient token: ${to}`);
    }
    send(ctx, { from: 'coder', to });
  });
  scoped(/^the coder sends a git_handoff for "([^"]+)" addressed to (\S+)$/, (ctx, ticketId, to) => {
    if (!KNOWN_ROLES.has(to)) {
      throw new Error(`unknown recipient token: ${to}`);
    }
    send(ctx, { from: 'coder', to, task: `${ticketId}-probe` });
  });

  scoped(/^the parcel is delivered to QA and to no other role$/, (ctx) => {
    assertDeliveredOnlyTo(ctx, 'QA');
  });
  scoped(/^the parcel is delivered to cleaner and to no other role$/, (ctx) => {
    assertDeliveredOnlyTo(ctx, 'cleaner');
  });
  scoped(/^the send exits successfully$/, (ctx) => {
    // assertDeliveredOnlyTo already checked status BEFORE cleanup; this
    // re-states the invariant-2 contract explicitly for the scenario text.
    assert.equal(ctx.sendStatus, 0, `the send must exit zero:\n${ctx.sendOut}`);
  });

  scoped(/^the recorded skip carries the rejection reason for that declaration$/, (ctx) => {
    try {
      assert.equal(ctx.sendStatus, 0, `send must succeed:\n${ctx.sendOut}`);
      const jsonlPath = path.join(ctx.root, '.swarmforge', 'routing-skips.jsonl');
      assert.ok(fs.existsSync(jsonlPath), 'a routing-skips.jsonl record must exist');
      const lines = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
      const withReason = lines.filter((l) => typeof l['rejection-reason'] === 'string' && l['rejection-reason'].length > 0);
      assert.ok(
        withReason.length > 0,
        `the skip record must carry the declaration's rejection reason (only a REF-read declaration can supply it): ${JSON.stringify(lines)}`
      );
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
