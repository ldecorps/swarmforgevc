'use strict';

// BL-951: step handlers for "A forward hop that jumps stages is recorded
// whatever the ticket declares". Drives the REAL swarm_handoff.bb send path
// against a fixture root (the test_required_stages_ticket_lookup_collision.sh
// recipe: SWARMFORGE_REQUIRED_STAGES_ROUTING=1 to enable routing,
// SWARMFORGE_SKIP_SYNC_INJECT=1 to skip tmux) - never a reimplementation of
// routing or recording. Both durable artifacts are asserted per invariant 3:
// the envelope's routing_skipped header AND the routing-skips.jsonl line.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_HANDOFF = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.bb');

const FEATURE = 'A forward hop that jumps stages is recorded whatever the ticket declares';

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

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
}

// The declaration states scenario 01 enumerates. `invalid` is a PRESENT,
// list-shaped declaration whose content resolve-effective rejects (QA
// omitted while coder is present - required_stages_lib's own named
// rejection), which the old code folded into the same silent bucket as
// "absent". KNOWN_VALUES: an unknown token throws.
const DECLARATIONS = {
  absent: '',
  invalid: 'required_stages: [coder, cleaner]\n',
  'full-chain': 'required_stages: [coder, cleaner, architect, hardender, documenter, qa]\n',
};

function mkFixture(ctx) {
  const root = mkTmp('sfvc-bl951-');
  git(root, ['init', '-q']);
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'features', 'x.feature'), 'Feature: x\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  ctx.commit = git(root, ['rev-parse', '--short=10', 'HEAD']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  const rows = ['coordinator', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']
    .map((r) => `${r}\t${r === 'coordinator' ? 'master' : r}\t${root}\tswarmforge-${r}\tX\tclaude\ttask`)
    .join('\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${rows}\n`);
  ctx.root = root;
}

function writeTicket(ctx, declaration) {
  fs.writeFileSync(
    path.join(ctx.root, 'backlog', 'active', 'BL-951-probe.yaml'),
    `id: BL-951\ntitle: "probe"\nstatus: active\nacceptance: specs/features/x.feature\n${declaration}`
  );
}

function send(ctx, { from, to }) {
  const draft = path.join(ctx.root, 'draft.txt');
  fs.writeFileSync(draft, `type: git_handoff\nto: ${to}\npriority: 50\ntask: BL-951-probe\ncommit: ${ctx.commit}\n`);
  const res = spawnSync('bb', [SWARM_HANDOFF, 'draft.txt'], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      SWARMFORGE_ROLE: from,
      SWARMFORGE_SKIP_SYNC_INJECT: '1',
      SWARMFORGE_REQUIRED_STAGES_ROUTING: '1',
    },
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.equal(res.status, 0, `expected the send to succeed, got exit ${res.status}:\n${out}`);
  const m = out.match(/:(\/[^\s]*\.handoff)/g);
  assert.ok(m && m.length, `no installed handoff file reported:\n${out}`);
  ctx.envelopePath = m[m.length - 1].slice(1);
  ctx.envelope = fs.readFileSync(ctx.envelopePath, 'utf8');
  const jsonlPath = path.join(ctx.root, '.swarmforge', 'routing-skips.jsonl');
  ctx.jsonlLines = fs.existsSync(jsonlPath)
    ? fs.readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];
}

const FULL_JUMP = ['cleaner', 'architect', 'hardender', 'documenter'];

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^required_stages routing is enabled$/,
    (ctx) => {
      mkFixture(ctx); // routing enabled per-send via SWARMFORGE_REQUIRED_STAGES_ROUTING=1
    },
    FEATURE
  );

  registry.defineScoped(
    /^the ticket "BL-951-probe" is active$/,
    (ctx) => {
      writeTicket(ctx, DECLARATIONS.absent);
    },
    FEATURE
  );

  // ── Givens ───────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the ticket's required_stages declaration is (.+)$/,
    (ctx, token) => {
      if (!Object.prototype.hasOwnProperty.call(DECLARATIONS, token)) {
        throw new Error(`unknown <declaration> token: ${token}`);
      }
      writeTicket(ctx, DECLARATIONS[token]);
    },
    FEATURE
  );

  // ── Whens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the coder sends a git_handoff addressed to (QA|cleaner)$/,
    (ctx, to) => {
      send(ctx, { from: 'coder', to });
    },
    FEATURE
  );

  registry.defineScoped(
    /^QA sends a git_handoff addressed to coder$/,
    (ctx) => {
      send(ctx, { from: 'QA', to: 'coder' });
    },
    FEATURE
  );

  // ── Thens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the handoff envelope carries a routing_skipped header naming cleaner, architect, hardender and documenter$/,
    (ctx) => {
      const line = ctx.envelope.split('\n').find((l) => l.startsWith('routing_skipped: '));
      assert.ok(line, `expected a routing_skipped header, envelope:\n${ctx.envelope}`);
      for (const stage of FULL_JUMP) {
        assert.ok(line.includes(stage), `expected ${stage} in: ${line}`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^exactly one routing-skips log line records those same four stages$/,
    (ctx) => {
      assert.equal(ctx.jsonlLines.length, 1, `expected exactly one log line, got: ${JSON.stringify(ctx.jsonlLines)}`);
      assert.deepEqual(ctx.jsonlLines[0].skipped, FULL_JUMP);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the handoff envelope carries no routing_skipped header$/,
    (ctx) => {
      assert.ok(
        !ctx.envelope.includes('routing_skipped:'),
        `expected no routing_skipped header, envelope:\n${ctx.envelope}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^no routing-skips log line is written$/,
    (ctx) => {
      assert.deepEqual(ctx.jsonlLines, []);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the recorded skip carries the rejection reason for that declaration$/,
    (ctx) => {
      assert.equal(ctx.jsonlLines.length, 1);
      const rejected = ctx.jsonlLines[0]['rejection-reason'];
      assert.ok(rejected && /QA cannot be omitted/.test(rejected), `expected the lib's own rejection reason, got: ${JSON.stringify(ctx.jsonlLines[0])}`);
      assert.match(ctx.envelope, /rejected="/);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the parcel is delivered to QA and to no other role$/,
    (ctx) => {
      const toLine = ctx.envelope.split('\n').find((l) => l.startsWith('to: '));
      assert.equal(toLine, 'to: QA', `expected delivery to QA alone, envelope:\n${ctx.envelope}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
