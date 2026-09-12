'use strict';

// BL-1536: step handlers for "A bounce from the terminal role is never
// stamped merge-only".
//
// Drives the REAL reverse_hop_lib.bb terminal-forward? - the single
// production implementation swarm_handoff.bb's with-non-forwarding
// delegates to - against a roles.tsv built from the scenario's own Given
// steps. Nothing here re-implements the direction math: a second copy of it
// is exactly how BL-1536's own defect (the sender-seat-only version) came to
// look correct under a unit runner that had never actually asserted the
// terminal-forward decision by direction.
//
// Why not drive `swarm_handoff.sh` end to end: a real git_handoff send runs
// the whole send-time gate stack (scope, required-stages, duplicate-chain,
// pre-QA, the two-call self-audit) and needs a git repo and a tmux socket.
// The mailbox-level end-to-end assertion is this ticket's
// test_swarm_handoff_bounce_never_stamped.sh and qa_e2e_procedure; here the
// contract is the STAMPING DECISION, driven through the production function
// that computes it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REVERSE_HOP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'reverse_hop_lib.bb');

const FEATURE_NAME = 'BL-1536 A bounce from the terminal role is never stamped merge-only';

// Explicit KNOWN_VALUES for every Scenario Outline placeholder - never a
// passthrough or a binary "did it parse" check. A row naming a role outside
// this list is a defect in the feature file, not a pass.
const KNOWN_ROLES = [
  'specifier',
  'coder',
  'cleaner',
  'architect',
  'hardender',
  'documenter',
  'QA',
  'coordinator',
];
const KNOWN_CARRIES = ['carries', 'does not carry'];

const MASTER_WORKTREE_NAME = 'master';

const FIXTURE_PREFIX = 'aps-bl1536-bounce-never-stamped-';
let trackedRoots = [];

// BL-971: sweep by prefix BEFORE the run too - a killed run traps nothing.
function sweepStaleFixtures() {
  const tmp = os.tmpdir();
  for (const entry of fs.readdirSync(tmp)) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(tmp, entry), { recursive: true, force: true });
    }
  }
}
sweepStaleFixtures();

afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function parseList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function assertKnownRole(role, where) {
  assert.ok(
    KNOWN_ROLES.includes(role),
    `${where}: "${role}" is not a known pack role (${KNOWN_ROLES.join(', ')})`
  );
}

function assertKnownCarries(carries) {
  assert.ok(
    KNOWN_CARRIES.includes(carries),
    `"${carries}" is not one of ${KNOWN_CARRIES.join(' / ')}`
  );
}

function initCtx(ctx) {
  if (ctx.bl1536) return ctx.bl1536;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  trackedRoots.push(root);
  ctx.bl1536 = {
    root,
    order: [],
    masterResident: new Set(),
  };
  return ctx.bl1536;
}

// The roles.tsv rows: the pipeline order from the Background, plus any
// master-resident role the scenarios named that is not already in it (the
// coordinator/specifier, which sit outside the forward chain). Column 2 is
// the worktree NAME and column 3 its absolute PATH; a master-resident row
// pairs "master" with the repo root, every other row its own worktree.
function rolesTsv(state) {
  const extra = [...state.masterResident].filter((r) => !state.order.includes(r));
  return [...state.order, ...extra]
    .map((role) => {
      const master = state.masterResident.has(role);
      const worktree = master ? MASTER_WORKTREE_NAME : role;
      const wtPath = master ? state.root : path.join(state.root, '.worktrees', role);
      return [
        role,
        worktree,
        wtPath,
        `swarmforge-${role}`,
        role,
        'claude',
        'task',
        'off',
        'forward-only',
      ].join('\t');
    })
    .join('\n');
}

function writeRolesTsv(state) {
  const dir = path.join(state.root, '.swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'roles.tsv'), `${rolesTsv(state)}\n`);
}

function bbEval(form) {
  return execFileSync('bb', ['-e', `(load-file "${REVERSE_HOP_LIB}") ${form}`], {
    encoding: 'utf8',
  }).trim();
}

function evalTerminalForward(state, sender, recipient) {
  writeRolesTsv(state);
  const out = bbEval(
    `(println (reverse-hop-lib/terminal-forward? (reverse-hop-lib/roles-lines "${state.root}") "${sender}" ["${recipient}"]))`
  );
  return out === 'true';
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  // ── Background / Givens ──────────────────────────────────────────────
  scoped(
    /^the roles table lists the code-worktree roles in order "([^"]*)"$/,
    (ctx, order) => {
      const state = initCtx(ctx);
      const roles = parseList(order);
      assert.ok(roles.length > 0, 'the pipeline order must name at least one role');
      for (const role of roles) assertKnownRole(role, 'pipeline order');
      state.order = roles;
    }
  );

  scoped(
    /^the roles table gives the master checkout as the worktree of "([^"]*)"$/,
    (ctx, roles) => {
      const state = initCtx(ctx);
      const named = parseList(roles);
      assert.ok(named.length > 0, 'at least one master-resident role must be named');
      for (const role of named) {
        assertKnownRole(role, 'master-resident roles');
        state.masterResident.add(role);
      }
    }
  );

  // ── When ──────────────────────────────────────────────────────────────
  scoped(
    /^the terminal stamp is decided for a git_handoff from "([^"]*)" to "([^"]*)"$/,
    (ctx, sender, recipient) => {
      const state = initCtx(ctx);
      assertKnownRole(sender, 'sender');
      assertKnownRole(recipient, 'recipient');
      state.sender = sender;
      state.recipient = recipient;
      state.carries = evalTerminalForward(state, sender, recipient);
    }
  );

  // ── Then ──────────────────────────────────────────────────────────────
  scoped(/^the parcel (carries|does not carry) the non-forwarding marker$/, (ctx, carries) => {
    const state = initCtx(ctx);
    assertKnownCarries(carries);
    assert.ok(
      typeof state.carries === 'boolean',
      'no terminal-stamp decision was computed before this assertion'
    );
    const expected = carries === 'carries';
    assert.equal(
      state.carries,
      expected,
      `git_handoff from "${state.sender}" to "${state.recipient}" ${state.carries ? 'carried' : 'did not carry'} non-forwarding, expected it to ${expected ? 'carry' : 'not carry'} it\nroles.tsv:\n${rolesTsv(state)}`
    );
  });
}

module.exports = { registerSteps };
