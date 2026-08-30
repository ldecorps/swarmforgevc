'use strict';

// BL-1299: step handlers for "A reverse hop never targets a role whose
// worktree is the master checkout".
//
// The scenarios drive the REAL reverse_hop_lib.bb - the single implementation
// swarm_handoff.bb's pack-role-names / last-pack-role? / role-propagation /
// reverse-roles all delegate to - against a roles.tsv built from the
// scenario's own Given steps. Nothing here re-implements the selection: a
// second copy of the math is exactly how the pre-fix unit runner came to
// assert the defect as correct.
//
// Why not drive `swarm_handoff.sh` end to end: a real git_handoff send runs
// the whole send-time gate stack (scope, required-stages, duplicate-chain,
// pre-QA) and needs a git repo, a two-call audit and a tmux socket. The
// mailbox-level end-to-end assertion is this ticket's qa_e2e_procedure,
// which QA runs against the live swarm; here the contract is the recipient
// SELECTION, driven through the production function that computes it.
//
// Master-residency is DERIVED from the table (human ruling 2026-08-30), so
// every row this handler writes is REALISTIC: worktree name "master" is
// paired with the repo root as its path, exactly as swarmforge.sh's
// parse_config writes the pair. A handler that set only one of the two would
// silently pick a winner between two correct derivations.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REVERSE_HOP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'reverse_hop_lib.bb');

const FEATURE_NAME =
  'A reverse hop never targets a role whose worktree is the master checkout';

// Explicit KNOWN_VALUES for every Scenario Outline placeholder - never a
// passthrough or a binary "did it parse" check. A row naming a role or mode
// outside these lists is a defect in the feature file, not a pass.
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
const KNOWN_MODES = ['forward-only', 'back-one', 'back-all'];

// The roles.tsv worktree-column values that mean "this role works in the
// master checkout" - mirrored from reverse_hop_lib.bb's own set so a change
// on either side shows up as a failing assertion rather than silent drift.
const MASTER_WORKTREE_NAME = 'master';

const FIXTURE_PREFIX = 'aps-bl1299-reverse-hop-';
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

function assertKnownMode(mode, where) {
  assert.ok(
    KNOWN_MODES.includes(mode),
    `${where}: "${mode}" is not a known propagation mode (${KNOWN_MODES.join(', ')})`
  );
}

function initCtx(ctx) {
  if (ctx.bl1299) return ctx.bl1299;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  trackedRoots.push(root);
  ctx.bl1299 = {
    root,
    order: [],
    masterResident: new Set(),
    propagation: new Map(),
  };
  return ctx.bl1299;
}

// The roles.tsv rows: the pipeline order from the Background, plus any
// master-resident role the scenarios named that is not already in it (the
// coordinator, which sits outside the forward chain). Column 2 is the
// worktree NAME and column 3 its absolute PATH; a master-resident row pairs
// "master" with the repo root, every other row its own worktree.
function rolesTsv(state) {
  const extra = [...state.masterResident].filter((r) => !state.order.includes(r));
  return [...state.order, ...extra]
    .map((role) => {
      const master = state.masterResident.has(role);
      const worktree = master ? MASTER_WORKTREE_NAME : role;
      const wtPath = master ? state.root : path.join(state.root, '.worktrees', role);
      const mode = state.propagation.get(role) || 'forward-only';
      return [
        role,
        worktree,
        wtPath,
        `swarmforge-${role}`,
        role,
        'claude',
        'task',
        'off',
        mode,
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

// EDN vectors of strings round-trip through JSON cleanly enough for an
// equality assertion once the symbols are quoted; print them as one
// comma-joined line instead so the comparison is over plain text.
function evalRoleList(state, form) {
  writeRolesTsv(state);
  const out = bbEval(
    `(println (clojure.string/join "," (let [lines (reverse-hop-lib/roles-lines "${state.root}")] ${form})))`
  );
  return parseList(out);
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^the pack pipeline roles in order are "([^"]*)"$/, (ctx, order) => {
    const state = initCtx(ctx);
    const roles = parseList(order);
    assert.ok(roles.length > 0, 'the pipeline order must name at least one role');
    for (const role of roles) assertKnownRole(role, 'pipeline order');
    state.order = roles;
  });

  // Additive, not replacing: the Background names the roles that are
  // master-resident in the live table, and scenario 04 adds one more on top.
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

  // ── Givens ────────────────────────────────────────────────────────────
  scoped(/^role "([^"]*)" declares propagation "([^"]*)"$/, (ctx, role, mode) => {
    const state = initCtx(ctx);
    assertKnownRole(role, 'propagation sender');
    assertKnownMode(mode, `propagation of ${role}`);
    assert.ok(
      state.order.includes(role) || state.masterResident.has(role),
      `${role} declares propagation but is in no roles-table row`
    );
    state.propagation.set(role, mode);
  });

  // ── Whens ─────────────────────────────────────────────────────────────
  scoped(/^reverse recipients are computed for sender "([^"]*)"$/, (ctx, sender) => {
    const state = initCtx(ctx);
    assertKnownRole(sender, 'reverse sender');
    state.recipients = evalRoleList(
      state,
      `(reverse-hop-lib/reverse-recipients lines "${sender}")`
    );
    state.sender = sender;
  });

  scoped(/^the terminal pack role is computed$/, (ctx) => {
    const state = initCtx(ctx);
    writeRolesTsv(state);
    state.terminal = bbEval(
      `(println (reverse-hop-lib/last-pipeline-role (reverse-hop-lib/roles-lines "${state.root}")))`
    );
  });

  // ── Thens ─────────────────────────────────────────────────────────────
  scoped(/^the reverse recipients are "([^"]*)"$/, (ctx, expected) => {
    const state = initCtx(ctx);
    assert.ok(Array.isArray(state.recipients), 'no reverse recipients were computed');
    const want = parseList(expected);
    for (const role of want) assertKnownRole(role, 'expected recipient');
    assert.deepEqual(
      state.recipients,
      want,
      `reverse recipients for ${state.sender} were [${state.recipients.join(', ')}], expected [${want.join(', ')}]\nroles.tsv:\n${rolesTsv(state)}`
    );
  });

  scoped(/^the reverse recipients do not include "([^"]*)"$/, (ctx, role) => {
    const state = initCtx(ctx);
    assert.ok(Array.isArray(state.recipients), 'no reverse recipients were computed');
    assertKnownRole(role, 'excluded recipient');
    assert.ok(
      state.masterResident.has(role),
      `${role} is not master-resident in this table, so excluding it would prove nothing`
    );
    assert.ok(
      !state.recipients.includes(role),
      `${role} was addressed a merge-only reverse copy: [${state.recipients.join(', ')}]`
    );
  });

  scoped(/^the terminal pack role is "([^"]*)"$/, (ctx, expected) => {
    const state = initCtx(ctx);
    assertKnownRole(expected, 'terminal role');
    assert.equal(
      state.terminal,
      expected,
      `terminal pack role was "${state.terminal}", expected "${expected}"\nroles.tsv:\n${rolesTsv(state)}`
    );
  });
}

module.exports = { registerSteps };
