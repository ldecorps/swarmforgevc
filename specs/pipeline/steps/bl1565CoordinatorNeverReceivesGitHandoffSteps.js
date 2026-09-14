'use strict';

// BL-1565: step handlers for "A git_handoff to the coordinator is refused
// at send".
//
// Scenario 01 drives the REAL git_handoff_recipient_guard_lib.bb decide -
// the same pure function swarm_handoff.bb's -main consults (on the literal
// draft header, and again on the post-routing recipient set) before
// `validate`, the self-audit challenge, and any mailbox write. No fixture
// root or roles.tsv needed for that (the bl1536 handler shape).
//
// Scenarios 02/03 drive the REAL swarm_handoff.bb end to end against a real
// fixture project (the bl1518 shape: fixture root, fixture roles.tsv, no
// live tmux session) - scenario 02 needs no real git object for its
// "commit: 0123456789" citation (the coordinator guard now runs before
// `validate` ever tries to resolve it), and scenario 03 needs delivery to
// actually reach the coordinator's own inbox/new/ synchronously: a
// placeholder `.swarmforge/tmux-socket` file (any content) is enough - the
// recipient file is written to inbox/new/ before write-parcel-to-recipients!
// ever attempts a real tmux call, and that later tmux attempt's failure is
// caught well outside this scenario's own assertions.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot, SHORT_FIXTURE_BASE } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');
const GUARD_LIB = path.join(SCRIPTS_DIR, 'git_handoff_recipient_guard_lib.bb');
const BB = process.env.BB_BIN || 'bb';

const FEATURE_NAME = 'BL-1565 A git_handoff to the coordinator is refused at send';

// Explicit KNOWN_VALUES for every Scenario Outline placeholder - never a
// passthrough or a binary "did it parse" check.
const KNOWN_TYPES = ['git_handoff', 'note', 'awake', 'rule_proposal'];
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
const KNOWN_DECISIONS = ['refuse', 'allow'];

function parseList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function assertKnown(list, value, where) {
  assert.ok(list.includes(value), `${where}: "${value}" is not one of ${list.join(', ')}`);
}

function bbDecide(type, recipients) {
  const recipientsEdn = `[${recipients.map((r) => `"${r}"`).join(' ')}]`;
  return execFileSync(BB, [
    '-e',
    `(load-file "${GUARD_LIB}") (println (name (:decision (git-handoff-recipient-guard-lib/decide {:type "${type}" :recipients ${recipientsEdn}}))))`,
  ], { encoding: 'utf8' }).trim();
}

// ── fixture project (Background, scenarios 02/03) ──────────────────────
// BL-948: this fixture builds a placeholder `.swarmforge/tmux-socket`
// pointer file (see initFixture below), so its root must come from the
// short-base helper, never a raw os.tmpdir()-rooted mkdtemp - the guard
// (socketFixtureShortRootGuard.test.js) refuses any step file that builds
// or references a tmux-socket path while rooted at the long macOS
// os.tmpdir() base, whether or not the socket is ever live.
const FIXTURE_PREFIX = 'bl1565-coord-';

let trackedRoots = [];

// BL-971: sweep by prefix BEFORE the run too - a killed run traps nothing.
function sweepStaleFixtures() {
  const base = SHORT_FIXTURE_BASE;
  for (const entry of fs.readdirSync(base)) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(base, entry), { recursive: true, force: true });
    }
  }
}
sweepStaleFixtures();

afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function roleDir(state, role) {
  return state.masterResident.has(role) ? state.root : path.join(state.root, '.worktrees', role);
}

function writeRolesTsv(state) {
  const extra = [...state.masterResident].filter((r) => !state.order.includes(r));
  const rows = [...state.order, ...extra]
    .map((role) => {
      const master = state.masterResident.has(role);
      const worktree = master ? 'master' : role;
      return [role, worktree, roleDir(state, role), `swarmforge-${role}`, role, 'claude', 'task'].join('\t');
    })
    .join('\n');
  const dir = path.join(state.root, '.swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'roles.tsv'), `${rows}\n`);
}

function initFixture() {
  const root = mkSocketFixtureRoot(FIXTURE_PREFIX);
  trackedRoots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'seed'], { cwd: root });
  const stateDir = path.join(root, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  // A placeholder socket path (never a live tmux server) is enough:
  // write-parcel-to-recipients! writes the recipient's inbox/new file
  // BEFORE it ever attempts a real tmux call, so a later tmux failure
  // (caught well outside this scenario's own assertions) never stops the
  // file from landing.
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/nonexistent/bl1565-fixture.sock');
  return { root, order: [], masterResident: new Set() };
}

function runSwarmHandoff(cwd, draftPath, role) {
  const res = spawnSync(BB, [SWARM_HANDOFF, draftPath], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, SWARMFORGE_ROLE: role },
  });
  return { status: res.status, output: `${res.stdout || ''}\n${res.stderr || ''}` };
}

function writeDraft(state, sender, body) {
  const dir = path.join(roleDir(state, sender), 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const draftPath = path.join(dir, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, body);
  return draftPath;
}

function newDirsUnderFixture(state) {
  const dirs = [];
  for (const role of state.order) {
    dirs.push(path.join(roleDir(state, role), '.swarmforge', 'handoffs', 'inbox', 'new'));
  }
  for (const role of state.masterResident) {
    dirs.push(path.join(state.root, '.swarmforge', 'handoffs', role, 'inbox', 'new'));
  }
  return dirs;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a fixture project whose roles table lists the code-worktree roles in order "([^"]*)"$/,
    (ctx, order) => {
      ctx.bl1565 = initFixture();
      const roles = parseList(order);
      assert.ok(roles.length > 0, 'the pipeline order must name at least one role');
      for (const role of roles) assertKnown(KNOWN_ROLES, role, 'pipeline order');
      ctx.bl1565.order = roles;
    }
  );

  scoped(
    /^the roles table gives the master checkout as the worktree of "([^"]*)"$/,
    (ctx, roles) => {
      const named = parseList(roles);
      assert.ok(named.length > 0, 'at least one master-resident role must be named');
      for (const role of named) {
        assertKnown(KNOWN_ROLES, role, 'master-resident roles');
        ctx.bl1565.masterResident.add(role);
      }
      writeRolesTsv(ctx.bl1565);
    }
  );

  // ── Scenario 01: the pure decision, no fixture needed ───────────────
  scoped(
    /^the recipient guard decides a "([^"]*)" draft from "([^"]*)" to "([^"]*)"$/,
    (ctx, type, sender, recipients) => {
      assertKnown(KNOWN_TYPES, type, 'type');
      assertKnown(KNOWN_ROLES, sender, 'sender');
      const recipientList = parseList(recipients);
      assert.ok(recipientList.length > 0, 'recipients must name at least one role');
      for (const role of recipientList) assertKnown(KNOWN_ROLES, role, 'recipients');
      ctx.bl1565 = ctx.bl1565 || {};
      ctx.bl1565.decisionInput = { type, sender, recipients: recipientList };
      ctx.bl1565.decision = bbDecide(type, recipientList);
    }
  );

  scoped(/^the decision is "([^"]*)"$/, (ctx, decision) => {
    assertKnown(KNOWN_DECISIONS, decision, 'decision');
    const state = ctx.bl1565;
    assert.ok(state && state.decision, 'no decision was computed before this assertion');
    assert.equal(
      state.decision,
      decision,
      `decide for type "${state.decisionInput.type}" from "${state.decisionInput.sender}" to "${state.decisionInput.recipients.join(',')}" returned "${state.decision}", expected "${decision}"`
    );
  });

  // ── Scenarios 02/03: the real sender, end to end ────────────────────
  scoped(
    /^a "([^"]*)" draft from "([^"]*)" to "([^"]*)" naming task "([^"]*)" and commit "([^"]*)"$/,
    (ctx, type, sender, recipient, task, commit) => {
      assertKnown(KNOWN_TYPES, type, 'type');
      assertKnown(KNOWN_ROLES, sender, 'sender');
      assertKnown(KNOWN_ROLES, recipient, 'recipient');
      ctx.bl1565.sender = sender;
      ctx.bl1565.draftPath = writeDraft(
        ctx.bl1565,
        sender,
        `type: ${type}\nto: ${recipient}\npriority: 00\ntask: ${task}\ncommit: ${commit}\n`
      );
    }
  );

  scoped(
    /^a "([^"]*)" draft from "([^"]*)" to "([^"]*)" reading "([^"]*)"$/,
    (ctx, type, sender, recipient, message) => {
      assertKnown(KNOWN_TYPES, type, 'type');
      assertKnown(KNOWN_ROLES, sender, 'sender');
      assertKnown(KNOWN_ROLES, recipient, 'recipient');
      ctx.bl1565.sender = sender;
      ctx.bl1565.draftPath = writeDraft(
        ctx.bl1565,
        sender,
        `type: ${type}\nto: ${recipient}\npriority: 00\nmessage: ${message}\n`
      );
      ctx.bl1565.expectedMessage = message;
    }
  );

  scoped(/^swarm_handoff\.bb is run on that draft$/, (ctx) => {
    const state = ctx.bl1565;
    state.result = runSwarmHandoff(roleDir(state, state.sender), state.draftPath, state.sender);
  });

  scoped(/^it exits non-zero$/, (ctx) => {
    const { result } = ctx.bl1565;
    assert.notEqual(result.status, 0, `expected a non-zero exit, got ${result.status}: ${result.output}`);
  });

  scoped(/^its output names "([^"]*)" and the close shape "([^"]*)"$/, (ctx, typeNote, closeShape) => {
    const { output } = ctx.bl1565.result;
    assert.ok(output.includes(typeNote), `expected the output to name "${typeNote}", got: ${output}`);
    assert.ok(output.includes(closeShape), `expected the output to name the close shape "${closeShape}", got: ${output}`);
  });

  scoped(/^its output does not contain "([^"]*)"$/, (ctx, text) => {
    const { output } = ctx.bl1565.result;
    assert.ok(!output.includes(text), `expected the output to NOT contain "${text}", got: ${output}`);
  });

  scoped(/^no inbox under the fixture root holds a new file$/, (ctx) => {
    for (const dir of newDirsUnderFixture(ctx.bl1565)) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
      assert.equal(files.length, 0, `expected no new file under ${dir}, found: ${files.join(',')}`);
    }
  });

  scoped(/^the coordinator's inbox\/new\/ holds one note carrying that message$/, (ctx) => {
    const dir = path.join(ctx.bl1565.root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new');
    assert.ok(fs.existsSync(dir), `expected ${dir} to exist`);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
    assert.equal(files.length, 1, `expected exactly one queued file under ${dir}, found: ${files.join(',')}`);
    const content = fs.readFileSync(path.join(dir, files[0]), 'utf8');
    assert.ok(
      content.includes(ctx.bl1565.expectedMessage),
      `expected the queued note to carry "${ctx.bl1565.expectedMessage}", got:\n${content}`
    );
  });
}

module.exports = { registerSteps };
