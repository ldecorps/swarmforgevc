'use strict';

// BL-1018: step handlers for "a single-role repair command can never reach
// beyond its own session". Every scenario drives the REAL pure resolver
// (swarmforge/scripts/single_role_repair_lib.bb) through a bb subprocess and
// asserts over the commands it returns.
//
// Nothing here runs tmux, and that is the design, not a shortcut: the defect
// under test is "a repair took down the whole tmux server", which is not
// something a test may provoke to observe. The ticket's own direction is to
// pin the RESOLUTION, which is pure - and the live half is recorded as a
// manual procedure in qa_e2e_procedure step 4.
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants
// only.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'a single-role repair command can never reach beyond its own session';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'single_role_repair_lib.bb');

// Fixture constants. The socket is a literal pack-socket-shaped path; the
// point of every assertion below is that it appears in EVERY resolved command.
const SOCKET = '/tmp/bl1018-pack.sock';
const ROLE = 'specifier';
const SESSION = `swarmforge-${ROLE}`;
const LAUNCH = '/repo/.swarmforge/launch/specifier.sh';

// Explicit known values per the Scenario Outline handler rule: the closed set
// the feature's Examples and its two literal scenarios actually use. A value
// these handlers do not know is a hard failure, never a passthrough.
const KNOWN_SESSION_STATES = new Map([
  ['missing', false],
  ['present', true],
  ['exists', true],
]);

function resolve(sessionPresent) {
  const expr = `
(require '[cheshire.core :as json])
(load-file "${LIB}")
(println (json/generate-string
  (single-role-repair-lib/resolve-single-role-repair
    {:socket "${SOCKET}" :role "${ROLE}" :session "${SESSION}"
     :launch-script "${LAUNCH}"
     :env-args ["-e" "OPENROUTER_API_KEY=k"]
     :session-present? ${sessionPresent}})))`;
  return JSON.parse(execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim());
}

const has = (cmd, token) => cmd.includes(token);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a pack whose tmux socket is known$/, (ctx) => {
    ctx.socket = SOCKET;
  });

  scoped(/^role "([^"]+)" whose session (?:is (missing|present)|(exists))$/, (ctx, role, state, existsWord) => {
    const key = state || existsWord;
    assert.ok(KNOWN_SESSION_STATES.has(key), `unknown session state "${key}" - the handlers know ${[...KNOWN_SESSION_STATES.keys()]}`);
    assert.equal(role, ROLE, `the fixture is built for role "${ROLE}"; the feature asked for "${role}"`);
    ctx.sessionPresent = KNOWN_SESSION_STATES.get(key);
  });

  scoped(/^a single-role repair is resolved for that role$/, (ctx) => {
    ctx.resolved = resolve(ctx.sessionPresent);
    assert.equal(ctx.resolved.status, 'ok', `the resolver must return a defined, safe command set: ${JSON.stringify(ctx.resolved)}`);
    ctx.commands = ctx.resolved.commands;
    // Invariant 2's own half: resolution is TOTAL - never an empty set for
    // either observed state, which would leave the caller with nothing to run
    // and no refusal to report.
    assert.ok(ctx.commands.length > 0, 'resolution must be total over session state - an empty command set is a fall-through');
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^the resolved commands create that role's session$/, (ctx) => {
    const creates = ctx.commands.filter((c) => has(c, 'new-session'));
    assert.equal(creates.length, 1, `exactly one create is owed: ${JSON.stringify(ctx.commands)}`);
    assert.ok(has(creates[0], '-s') && has(creates[0], SESSION), `the create must name this role's session: ${JSON.stringify(creates[0])}`);
    // The create carries the launch command, which is what makes the
    // follow-up respawn unnecessary rather than merely forbidden.
    assert.ok(
      creates[0].some((a) => a.includes(LAUNCH)),
      `the create must carry the role's launch script, or the pane is left on a bare shell: ${JSON.stringify(creates[0])}`
    );
  });

  scoped(/^no resolved command is a respawn-pane against the missing session$/, (ctx) => {
    const respawns = ctx.commands.filter((c) => has(c, 'respawn-pane'));
    assert.deepEqual(respawns, [], 'a missing session must never be respawned into - the BL-958 hazard this slice exists to remove');
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^the resolved commands respawn that role's pane$/, (ctx) => {
    const respawns = ctx.commands.filter((c) => has(c, 'respawn-pane'));
    assert.equal(respawns.length, 1, `exactly one respawn is owed: ${JSON.stringify(ctx.commands)}`);
    assert.ok(has(respawns[0], '-t') && has(respawns[0], SESSION), `the respawn must target this role's session: ${JSON.stringify(respawns[0])}`);
  });

  scoped(/^no resolved command creates a session that already exists$/, (ctx) => {
    const creates = ctx.commands.filter((c) => has(c, 'new-session'));
    assert.deepEqual(creates, [], 'a session that already exists must never be created again');
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^every resolved command names the pack socket explicitly$/, (ctx) => {
    for (const cmd of ctx.commands) {
      assert.deepEqual(
        cmd.slice(0, 3),
        ['tmux', '-S', SOCKET],
        `a command that inherits the default socket can reach a server nobody intended to touch: ${JSON.stringify(cmd)}`
      );
    }
  });

  scoped(/^every resolved command targets only that role's own session$/, (ctx) => {
    for (const cmd of ctx.commands) {
      const named = cmd.filter((a) => typeof a === 'string' && a.startsWith('swarmforge-'));
      assert.deepEqual(named, [SESSION], `exactly one session may be named, and it must be this role's: ${JSON.stringify(cmd)}`);
    }
  });

  scoped(/^no resolved command is a kill-server or a kill-session$/, (ctx) => {
    for (const cmd of ctx.commands) {
      // The assertion that would have caught the 2026-08-21 incident.
      assert.ok(!has(cmd, 'kill-server'), `no repair may resolve to kill-server: ${JSON.stringify(cmd)}`);
      assert.ok(!has(cmd, 'kill-session'), `no repair may resolve to kill-session: ${JSON.stringify(cmd)}`);
    }
  });
}

module.exports = { registerSteps };
