'use strict';

// BL-1960: step handlers for "A deterministic router pack stands only its
// resident". Drives the REAL swarmforge.sh (sourced, the same
// ZSH_EVAL_CONTEXT-toplevel-guard convention test_rotation_sequential_pack.sh
// and bl1959DeterministicPackLaunchKeepsTheCoordinatorRowSteps.js already
// use - no real tmux launch, no reimplementation of the launch logic):
// parse_config, write_roles_file, prepare_handoff_dirs, then the SAME two
// guard predicates each real launch loop checks (is_sequential_dormant,
// is_coordinator_seatless) gating the REAL session-creating function
// (create_role_session, against a private throwaway tmux socket -
// BL-367's own project-private resolve_swarm_socket.bb).
//
// No production code change is needed for this scenario: under
// `config rotation router`, is_sequential_dormant (swarmforge.sh:1308)
// already returns true for every middle pipeline role (i > 1 && i <
// ${#ROLES[@]}), and is_coordinator_seatless (swarmforge.sh:1330) already
// gates the coordinator on COORDINATOR_MODE == deterministic. The scenario
// passes on BL-1959's code alone - the step handler below is the evidence,
// not a new check.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot, onAbnormalExit } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1960 A deterministic router pack stands only its resident';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

function mkFixtureRoot() {
  const root = trackedTmpRoot('bl1960-deterministic-router-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['coder', 'QA', 'coordinator']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

function basePackConf() {
  return [
    'config swarm_name bl1960-fixture',
    'config rotation router',
    'config coordinator_mode deterministic',
    'window coder claude coder --model x',
    'window QA claude QA --model x',
    '',
  ].join('\n');
}

// The REAL launch loop's own guard shape, replicated with the REAL
// predicate and session-creating functions (is_sequential_dormant,
// is_coordinator_seatless, create_role_session) - never a second decision
// engine. tmux talks to a throwaway, project-private socket
// (resolve_swarm_socket.bb, sourced at the top of swarmforge.sh
// unconditionally) so this never touches a live swarm's own session.
const LAUNCH_SNIPPET = `
parse_config
write_roles_file
prepare_handoff_dirs
typeset -a CREATED_SESSIONS=()
for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
  if is_sequential_dormant "$i" || is_coordinator_seatless "$i"; then
    continue
  fi
  create_role_session "\${SESSIONS[$i]}" "\${DISPLAY_NAMES[$i]}" "\${ROLES[$i]}"
  CREATED_SESSIONS+=("\${SESSIONS[$i]}")
done
print -l -- "\${ROLES[@]}" > "$OUT_DIR/roles.txt"
print -l -- "\${CREATED_SESSIONS[@]}" > "$OUT_DIR/created_sessions.txt"
tmux -S "$TMUX_SOCKET" list-sessions -F '#{session_name}' > "$OUT_DIR/tmux_sessions.txt" 2>/dev/null || true
`;

function runLaunch(ctx) {
  const outDir = path.join(ctx.root, '.out');
  fs.mkdirSync(outDir, { recursive: true });
  const childEnv = { ...process.env, PACK_STAFFING_SKIP_GATE: '1', OUT_DIR: outDir };
  delete childEnv.SWARMFORGE_CONFIG;
  execFileSync('zsh', ['-c', `source '${SWARMFORGE_SH}' '${ctx.root}'\n${LAUNCH_SNIPPET}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  });
  ctx.outDir = outDir;
  ctx.roles = readLines(path.join(outDir, 'roles.txt'));
  ctx.createdSessions = readLines(path.join(outDir, 'created_sessions.txt'));
  ctx.liveTmuxSessions = readLines(path.join(outDir, 'tmux_sessions.txt'));

  // Teardown: kill the throwaway tmux server this run may have started, on
  // ITS OWN private socket only - never the live swarm's. Registered via
  // onAbnormalExit too, so a killed/crashed test run still reaps it.
  const tmuxSocket = execFileSync('zsh', ['-c', `source '${SWARMFORGE_SH}' '${ctx.root}' >/dev/null 2>&1; print -r -- "$TMUX_SOCKET"`], {
    encoding: 'utf8',
  }).trim();
  ctx.tmuxSocket = tmuxSocket;
  const killThisServer = () => {
    try {
      execFileSync('tmux', ['-S', tmuxSocket, 'kill-server'], { stdio: 'ignore' });
    } catch {
      // no server ever started - fine.
    }
  };
  onAbnormalExit(killThisServer);
  killThisServer();
}

function readLines(p) {
  try {
    return fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    ctx.packConf = basePackConf();
    fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), ctx.packConf);
  });

  // ── router-pack-keeps-one-standing-session-01 ────────────────────────
  scoped(/^the pack is launched$/, (ctx) => runLaunch(ctx));

  scoped(/^the resident's session is the only role session created$/, (ctx) => {
    // Exactly ONE session created, and it is the resident's (index 1,
    // swarmforge-coder). QA (index 2) and the coordinator (index 3) got
    // none: is_sequential_dormant gates the middle pipeline role, and
    // is_coordinator_seatless gates the coordinator on a deterministic
    // pack - both already in production (swarmforge.sh:1308, :1330).
    assert.equal(ctx.createdSessions.length, 1, `expected exactly one created session, got: ${JSON.stringify(ctx.createdSessions)}`);
    assert.ok(
      ctx.createdSessions[0].includes('coder'),
      `expected the resident's (coder's) session to be the one created, got: ${JSON.stringify(ctx.createdSessions)}`
    );
    assert.ok(
      !ctx.createdSessions.some((s) => s.includes('QA')),
      `expected no QA session among created sessions, got: ${JSON.stringify(ctx.createdSessions)}`
    );
    assert.ok(
      !ctx.createdSessions.some((s) => s.includes('coordinator')),
      `expected no coordinator session among created sessions, got: ${JSON.stringify(ctx.createdSessions)}`
    );
    assert.ok(
      !ctx.liveTmuxSessions.some((s) => s.includes('QA')),
      `expected no live tmux session naming QA, got: ${JSON.stringify(ctx.liveTmuxSessions)}`
    );
    assert.ok(
      !ctx.liveTmuxSessions.some((s) => s.includes('coordinator')),
      `expected no live tmux session naming the coordinator, got: ${JSON.stringify(ctx.liveTmuxSessions)}`
    );
  });
}

module.exports = { registerSteps };
