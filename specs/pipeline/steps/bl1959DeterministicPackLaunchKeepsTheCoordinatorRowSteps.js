'use strict';

// BL-1959: step handlers for "A deterministic pack's launch keeps the
// coordinator's row and starts no coordinator seat". Drives the REAL
// swarmforge.sh (sourced, the same ZSH_EVAL_CONTEXT-toplevel-guard
// convention test_coordinator_provisioned_infrastructure.sh and
// test_rotation_sequential_pack.sh already use - no real tmux launch, no
// reimplementation of the launch logic): parse_config (which internally
// calls provision_coordinator, BL-243), write_roles_file,
// prepare_handoff_dirs, then the SAME two guard predicates each real
// launch loop checks (is_sequential_dormant, is_coordinator_seatless)
// gating the REAL session-creating function (create_role_session, against
// a private throwaway tmux socket - BL-367's own project-private
// resolve_swarm_socket.bb) and the REAL launch-script writer
// (write_role_launch_script). The for-loop/continue shape itself is
// boilerplate, not logic under test; the gating functions and the
// session/file writers are the real article.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot, onAbnormalExit } = require('./lib/fixtureReaper');

const FEATURE = "BL-1959 A deterministic pack's launch keeps the coordinator's row and starts no coordinator seat";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

const DETERMINISTIC_LINE = 'config coordinator_mode deterministic';

function mkFixtureRoot() {
  const root = trackedTmpRoot('bl1959-deterministic-launch-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['coder', 'coordinator']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

function basePackConf() {
  return ['config swarm_name bl1959-fixture', 'config rotation router', DETERMINISTIC_LINE, 'window coder claude coder --model x', ''].join('\n');
}

// The REAL launch loops' own guard shape, replicated with the REAL
// predicate and writer functions (BL-1959's own: is_sequential_dormant,
// is_coordinator_seatless, create_role_session, write_role_launch_script)
// - never a second decision engine. tmux talks to a throwaway, project-
// private socket (resolve_swarm_socket.bb, sourced at the top of
// swarmforge.sh unconditionally) so this never touches a live swarm's own
// session.
const LAUNCH_SNIPPET = `
parse_config
write_roles_file
prepare_handoff_dirs
typeset -a CREATED_SESSIONS=()
typeset -a WROTE_LAUNCH_SCRIPT_FOR=()
for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
  if is_sequential_dormant "$i" || is_coordinator_seatless "$i"; then
    continue
  fi
  create_role_session "\${SESSIONS[$i]}" "\${DISPLAY_NAMES[$i]}" "\${ROLES[$i]}"
  CREATED_SESSIONS+=("\${SESSIONS[$i]}")
done
for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
  if is_sequential_dormant "$i" || is_coordinator_seatless "$i"; then
    continue
  fi
  write_role_launch_script "$i" >/dev/null
  WROTE_LAUNCH_SCRIPT_FOR+=("\${ROLES[$i]}")
done
print -l -- "\${ROLES[@]}" > "$OUT_DIR/roles.txt"
print -l -- "\${CREATED_SESSIONS[@]}" > "$OUT_DIR/created_sessions.txt"
print -l -- "\${WROTE_LAUNCH_SCRIPT_FOR[@]}" > "$OUT_DIR/wrote_launch_script_for.txt"
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
  ctx.wroteLaunchScriptFor = readLines(path.join(outDir, 'wrote_launch_script_for.txt'));
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
      // no server ever started (e.g. the deterministic scenario created none) - fine.
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

  // ── deterministic-pack-launch-keeps-the-row-drops-the-seat-01 ─────────
  scoped(/^the pack is launched$/, (ctx) => runLaunch(ctx));

  scoped(/^roles\.tsv carries a coordinator row$/, (ctx) => {
    const rolesTsv = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), 'utf8');
    assert.match(rolesTsv, /^coordinator\t/m, `expected a coordinator row in roles.tsv, got:\n${rolesTsv}`);
  });

  scoped(/^the coordinator's inbox directories exist$/, (ctx) => {
    const mailbox = path.join(ctx.root, '.swarmforge', 'handoffs', 'coordinator');
    for (const sub of ['inbox/new', 'inbox/in_process', 'inbox/completed', 'inbox/abandoned', 'outbox/tmp', 'sent', 'failed']) {
      assert.ok(fs.existsSync(path.join(mailbox, sub)), `expected ${sub} to exist under the coordinator's mailbox`);
    }
  });

  scoped(/^no swarmforge-coordinator session was created$/, (ctx) => {
    assert.ok(
      !ctx.createdSessions.some((s) => s.includes('coordinator')),
      `expected no coordinator session among created sessions, got: ${JSON.stringify(ctx.createdSessions)}`
    );
    assert.ok(
      !ctx.liveTmuxSessions.some((s) => s.includes('coordinator')),
      `expected no live tmux session naming the coordinator, got: ${JSON.stringify(ctx.liveTmuxSessions)}`
    );
  });

  scoped(/^no coordinator launch script was written$/, (ctx) => {
    assert.ok(
      !ctx.wroteLaunchScriptFor.includes('coordinator'),
      `expected write_role_launch_script never called for the coordinator, got: ${JSON.stringify(ctx.wroteLaunchScriptFor)}`
    );
    assert.ok(
      !fs.existsSync(path.join(ctx.root, '.swarmforge', 'launch', 'coordinator.sh')),
      'expected .swarmforge/launch/coordinator.sh to not exist'
    );
  });

  // BL-1959 hardener pass: is_coordinator_seatless gates ONLY the
  // coordinator's own index - a mutant that drops the index check (seatless
  // for every role whenever the pack is deterministic) survived every other
  // scenario here, since none of them checked that a NON-coordinator role
  // still gets a session on a deterministic pack.
  registry.define(/^the coder session is among the sessions created$/, (ctx) => {
    assert.ok(
      ctx.createdSessions.some((s) => s.includes('coder')),
      `expected a coder session among created sessions on a deterministic pack, got: ${JSON.stringify(ctx.createdSessions)}`
    );
  });

  // ── a-non-deterministic-pack-still-provisions-the-seat-02 ─────────────
  scoped(/^the fixture pack's "config coordinator_mode deterministic" line is removed$/, (ctx) => {
    ctx.packConf = ctx.packConf
      .split('\n')
      .filter((l) => l.trim() !== DETERMINISTIC_LINE)
      .join('\n');
    fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), ctx.packConf);
  });

  scoped(/^a coordinator launch script was written$/, (ctx) => {
    assert.ok(
      ctx.wroteLaunchScriptFor.includes('coordinator'),
      `expected write_role_launch_script to have been called for the coordinator, got: ${JSON.stringify(ctx.wroteLaunchScriptFor)}`
    );
    assert.ok(fs.existsSync(path.join(ctx.root, '.swarmforge', 'launch', 'coordinator.sh')), 'expected .swarmforge/launch/coordinator.sh to exist');
  });

  scoped(/^the coordinator session is among the sessions created$/, (ctx) => {
    assert.ok(
      ctx.createdSessions.some((s) => s.includes('coordinator')),
      `expected a coordinator session among created sessions, got: ${JSON.stringify(ctx.createdSessions)}`
    );
  });
}

module.exports = { registerSteps };
