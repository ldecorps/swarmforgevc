'use strict';

// BL-991: step handlers for "A declared required_stages is binding".
//
// Drives the REAL swarm_handoff.bb send path against a fixture root - the
// same recipe BL-951's handlers use (SWARMFORGE_REQUIRED_STAGES_ROUTING=1 to
// enable routing, SWARMFORGE_SKIP_SYNC_INJECT=1 to skip tmux) - never a
// reimplementation of the routing rule. What each scenario asserts is who the
// envelope was actually addressed to on disk after the send, and what the two
// durable skip artifacts (the envelope header and routing-skips.jsonl) say.
//
// The kill-switch row is the one case that cannot ride that env var: with
// SWARMFORGE_REQUIRED_STAGES_ROUTING unset, the router reads
// swarmforge.conf, so the `disabled` row writes `false` into the fixture's
// own conf and sends without the override. Setting the env var and expecting
// it to be ignored would test nothing.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_HANDOFF = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.bb');

const FEATURE = 'A declared required_stages is binding';

// Explicit known values per the Scenario Outline handler rule: a row the
// handlers do not know is a hard failure, never a passthrough.
//
// `invalid` is a PRESENT, list-shaped declaration whose content
// resolve-effective rejects (QA omitted while coder is present), which
// resolves to default-full - so sender judgement still stands there.
// `documenter-only` omits coder, so it may legitimately omit QA, and it is
// the only way to reach "no declared stage after the sender": a fixture like
// [coder, cleaner] silently becomes default-full and would test nothing.
const DECLARATIONS = {
  absent: '',
  invalid: 'required_stages: [coder, cleaner]\n',
  'full-chain': 'required_stages: [coder, cleaner, architect, hardender, documenter, qa]\n',
  'no-cleaner': 'required_stages: [coder, architect, hardender, documenter, qa]\n',
  'coder-cleaner-qa': 'required_stages: [coder, cleaner, qa]\n',
  'documenter-only': 'required_stages: [documenter]\n',
};

const ROLES = ['coordinator', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const KNOWN_ROUTING = new Set(['enabled', 'disabled']);

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl991-'));
  trackedRoots.push(root);
  git(root, ['init', '-q']);
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'features', 'x.feature'), 'Feature: x\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  ctx.commit = git(root, ['rev-parse', '--short=10', 'HEAD']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `${ROLES.map((r) => `${r}\t${r === 'coordinator' ? 'master' : r}\t${root}\tswarmforge-${r}\tX\tclaude\ttask`).join('\n')}\n`
  );
  ctx.root = root;
  ctx.routingEnabled = true;
}

function writeTicket(ctx, declaration) {
  assert.ok(ctx.root, 'no fixture root was built before the ticket was written');
  fs.writeFileSync(
    path.join(ctx.root, 'backlog', 'active', `${ctx.ticketId}.yaml`),
    `id: BL-991\ntitle: "probe"\nstatus: active\nacceptance: specs/features/x.feature\n${declaration}`
  );
}

function send(ctx, from, to) {
  assert.ok(ctx.declarationWritten, 'no declaration state was established before the send');
  const draft = path.join(ctx.root, 'draft.txt');
  fs.writeFileSync(
    draft,
    `type: git_handoff\nto: ${to}\npriority: 50\ntask: ${ctx.ticketId}\ncommit: ${ctx.commit}\n`
  );
  const env = { ...process.env, SWARMFORGE_ROLE: from, SWARMFORGE_SKIP_SYNC_INJECT: '1' };
  if (ctx.routingEnabled) {
    env.SWARMFORGE_REQUIRED_STAGES_ROUTING = '1';
  } else {
    delete env.SWARMFORGE_REQUIRED_STAGES_ROUTING;
    fs.writeFileSync(
      path.join(ctx.root, 'swarmforge', 'swarmforge.conf'),
      'config required_stages_routing_enabled false\n'
    );
  }
  const res = spawnSync('bb', [SWARM_HANDOFF, 'draft.txt'], { cwd: ctx.root, encoding: 'utf8', env });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.equal(res.status, 0, `expected the send to succeed, got exit ${res.status}:\n${out}`);
  const matches = out.match(/:(\/[^\s]*\.handoff)/g);
  assert.ok(matches && matches.length, `no installed handoff file reported:\n${out}`);
  ctx.addressed = to;
  ctx.envelope = fs.readFileSync(matches[matches.length - 1].slice(1), 'utf8');
  const jsonl = path.join(ctx.root, '.swarmforge', 'routing-skips.jsonl');
  ctx.jsonlLines = fs.existsSync(jsonl)
    ? fs.readFileSync(jsonl, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];
}

// The `to:` line the envelope actually carries - the one fact every scenario
// here turns on.
function deliveredTo(ctx) {
  assert.ok(ctx.envelope, 'nothing was sent');
  const line = ctx.envelope.split('\n').find((l) => l.startsWith('to: '));
  assert.ok(line, `the envelope carries no to: header:\n${ctx.envelope}`);
  return line.slice(4).trim();
}

function assertDeliveredOnlyTo(ctx, expected) {
  const to = deliveredTo(ctx);
  assert.equal(to, expected, `expected delivery to ${expected}, got ${to}`);
  // "and to no other role": the recipient list is one name, not a set that
  // happens to contain the right one.
  assert.ok(
    !/[,\s]/.test(to),
    `expected exactly one recipient, got a list: ${JSON.stringify(to)}`
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────

  scoped(/^the ticket "(.+)" is active$/, (ctx, ticketId) => {
    assert.ok(fs.existsSync(SWARM_HANDOFF), `the send path under test is missing: ${SWARM_HANDOFF}`);
    ctx.ticketId = ticketId;
    mkFixture(ctx);
  });

  // ── Given ───────────────────────────────────────────────────────────────

  scoped(/^required_stages routing is (enabled|disabled)$/, (ctx, routing) => {
    assert.ok(
      KNOWN_ROUTING.has(routing),
      `unknown routing state "${routing}" - the handlers know ${[...KNOWN_ROUTING].join(', ')}`
    );
    ctx.routingEnabled = routing === 'enabled';
  });

  scoped(/^the ticket's required_stages declaration is (.+)$/, (ctx, declaration) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(DECLARATIONS, declaration),
      `unknown declaration "${declaration}" - the handlers know ${Object.keys(DECLARATIONS).join(', ')}`
    );
    writeTicket(ctx, DECLARATIONS[declaration]);
    ctx.declaration = declaration;
    ctx.declarationWritten = true;
  });

  // ── When ────────────────────────────────────────────────────────────────
  // Registered before the generic sender form below: scoped resolution scans
  // in registration order, and "the coder sends ..." must not fall through to
  // a pattern meant for the outline's bare "<sender> sends ...".

  scoped(/^the coder sends a git_handoff addressed to (.+)$/, (ctx, addressed) => {
    send(ctx, 'coder', addressed);
  });

  scoped(/^(\w+) sends a git_handoff addressed to (.+)$/, (ctx, sender, addressed) => {
    assert.ok(ROLES.includes(sender), `unknown sender "${sender}" - the handlers know ${ROLES.join(', ')}`);
    send(ctx, sender, addressed);
  });

  // ── Then ────────────────────────────────────────────────────────────────

  scoped(/^the parcel is delivered to the role it was addressed to and to no other role$/, (ctx) => {
    assertDeliveredOnlyTo(ctx, ctx.addressed);
  });

  scoped(/^the parcel is delivered to (.+) and to no other role$/, (ctx, delivered) => {
    assert.ok(ROLES.includes(delivered), `unknown role "${delivered}" - the handlers know ${ROLES.join(', ')}`);
    assertDeliveredOnlyTo(ctx, delivered);
  });

  scoped(/^the handoff envelope carries no routing_skipped header$/, (ctx) => {
    assert.ok(ctx.envelope, 'nothing was sent');
    assert.doesNotMatch(
      ctx.envelope,
      /^routing_skipped:/m,
      `a hop that skipped nothing still carried a routing_skipped header:\n${ctx.envelope}`
    );
  });

  // Invariant 2. A redirected hop defers QA; it does not skip it, and a record
  // saying otherwise is a defect even though the delivery is right.
  scoped(/^no routing-skips record names (\w+) as skipped$/, (ctx, stage) => {
    assert.ok(ctx.envelope, 'nothing was sent');
    const header = ctx.envelope.split('\n').find((l) => l.startsWith('routing_skipped:')) || '';
    const skippedField = /skipped=([^\s]*)/.exec(header);
    const inHeader = skippedField ? skippedField[1].split(',').includes(stage) : false;
    assert.equal(inHeader, false, `the envelope header names ${stage} as skipped: ${header}`);
    for (const line of ctx.jsonlLines) {
      assert.ok(
        !(line.skipped || []).includes(stage),
        `a routing-skips journal line names ${stage} as skipped: ${JSON.stringify(line)}`
      );
    }
  });
}

module.exports = { registerSteps };
