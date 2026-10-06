'use strict';

// BL-1775: step handlers for "a second swarm never runs with the
// primary's Telegram identity". Drives the REAL swarmforge.sh (sourced
// under zsh - BL-089's own ZSH_EVAL_CONTEXT toplevel guard means sourcing
// only defines functions/vars, never launches tmux/daemons for real,
// exactly the technique BL-961's own step file established) and the real
// swarm_telegram_env_cli.bb, over a fixture $HOME whose own .zshenv
// exports a fake primary token - never the real home, never a real bot.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// BL-1636: every throwaway root this file mkdtemps goes through the shared
// helper (registers it for reaping) rather than a bare fs.mkdtempSync.
const { mkTmpDir } = require('../../../extension/test/helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

const FEATURE = "BL-1775 A second swarm never runs with the primary's Telegram identity";

const KNOWN_PROCESSES = new Set([
  'a role launch script swarmforge.sh wrote',
  "a daemon started from swarmforge.sh's environment",
]);

let trackedDirs = [];

function __bl1659Dispose_bl1775() {
  while (trackedDirs.length) {
    fs.rmSync(trackedDirs.pop(), { recursive: true, force: true });
  }
}

function mkTrackedDir(ctx, prefix) {
  ctx.__disposables = ctx.__disposables || [];
  ctx.__disposables.push(__bl1659Dispose_bl1775);
  const dir = fs.realpathSync(mkTmpDir(prefix));
  trackedDirs.push(dir);
  return dir;
}

// Same SWARMFORGE_* strip list BL-961's own step file uses (the ambient
// pane's own exports must never leak into a fixture run) - re-derived
// here since this feature exercises a DIFFERENT function
// (apply_swarm_telegram_identity) that only *this* parcel's own commit
// adds, so grep'ing swarmforge.sh again would only re-confirm the same
// list BL-961 already keeps current.
const SWARMFORGE_VARS_READ_BY_LAUNCHER = [
  'SWARMFORGE_ALLOW_FULL_PACK', 'SWARMFORGE_CONFIG', 'SWARMFORGE_DAEMON_START_CALLER',
  'SWARMFORGE_GEMINI_API_KEY', 'SWARMFORGE_MAILBOX_ONLY', 'SWARMFORGE_OPENROUTER_ROLES',
  'SWARMFORGE_PACK', 'SWARMFORGE_REMOTE_CONTROL', 'SWARMFORGE_ROLE',
  'SWARMFORGE_ROLE_WORKTREE', 'SWARMFORGE_SKIP_DAEMON', 'SWARMFORGE_SKIP_FRONT_DESK',
  'SWARMFORGE_SKIP_OPERATOR', 'SWARMFORGE_SKIP_SHELL_RUN_RECORD', 'SWARMFORGE_TERMINAL',
  'SWARMFORGE_TERMINAL_BACKEND', 'SWARMFORGE_USE_CEREBRAS', 'SWARMFORGE_USE_PERPLEXITY',
  'SWARMFORGE_USE_QWEN',
];

function fixtureEnv(extra) {
  const env = { ...process.env, XDG_RUNTIME_DIR: '/tmp', PACK_STAFFING_SKIP_GATE: '1' };
  for (const name of SWARMFORGE_VARS_READ_BY_LAUNCHER) delete env[name];
  delete env.TELEGRAM_BOT_TOKEN;
  delete env.TELEGRAM_CHAT_ID;
  return { ...env, ...extra };
}

function mkFixtureHome(ctx) {
  const home = mkTrackedDir(ctx, 'bl1775-home-');
  fs.mkdirSync(path.join(home, '.swarmforge', 'fleet', 'primary'), { recursive: true });
  return home;
}

function writeZshenv(home, token, chat) {
  fs.writeFileSync(path.join(home, '.zshenv'), `export TELEGRAM_BOT_TOKEN='${token}'\nexport TELEGRAM_CHAT_ID='${chat}'\n`);
}

function recordPrimaryRoot(home, rootPath) {
  fs.mkdirSync(path.join(home, '.swarmforge', 'fleet', 'primary'), { recursive: true });
  fs.writeFileSync(path.join(home, '.swarmforge', 'fleet', 'primary', 'root'), rootPath);
}

function writeFleetCreds(home, swarmName, token, chat) {
  const dir = path.join(home, '.swarmforge', 'fleet', swarmName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram.json'), JSON.stringify({ botToken: token, chatId: chat }));
}

function mkTargetRoot(ctx, swarmName) {
  const root = mkTrackedDir(ctx, 'bl1775-target-');
  for (const dir of ['swarmforge/roles', 'swarmforge/packs', '.swarmforge/launch', '.swarmforge/prompts']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), 'constitution\n');
  fs.writeFileSync(path.join(root, 'swarmforge', 'roles', 'coder.prompt'), 'role prompt\n');
  const confLines = [
    `config swarm_name ${swarmName}`,
    // worktree "master" (never "coder") - so write_role_launch_script's
    // own role_worktree == WORKING_DIR special case fires and
    // role_script_dir resolves to the REAL $SCRIPT_DIR (this repo's own
    // swarmforge/scripts/, where swarm_telegram_env_cli.bb actually
    // lives) rather than a never-created .worktrees/coder that has no
    // scripts of its own in this minimal fixture.
    'window coder claude master --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low',
  ];
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), confLines.join('\n') + '\n');
  return root;
}

const INDEX_SNIPPET =
  'index_of_role() { local target="$1" i; for (( i = 1; i <= ${#ROLES[@]}; i++ )); do [[ "${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }; done }';

// Generates the real role launch script(s) for `roles` via the REAL
// write_role_launch_script (BL-961's own established technique: sourcing
// under zsh only defines functions/vars - BL-089's ZSH_EVAL_CONTEXT
// toplevel guard skips the real tmux/daemon launch). Generation never
// needs the fixture $HOME (the identity eval line it embeds is resolved
// at the GENERATED SCRIPT'S OWN run time, not at generation time), so
// this runs under the real ambient environment, stripped of the vars the
// launcher itself reads.
function generateRoleLaunchScripts(root, roles) {
  const writes = roles.map((r) => `write_role_launch_script "$(index_of_role ${r})"`).join('; ');
  const result = spawnSync(
    'zsh',
    ['-c', `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${INDEX_SNIPPET}; ${writes}`],
    { encoding: 'utf8', env: fixtureEnv({}) }
  );
  assert.equal(result.status, 0, `generating launch script(s) failed:\n${result.stdout}\n${result.stderr}`);
  return roles.map((r) => path.join(root, '.swarmforge', 'launch', `${r}.sh`));
}

// Extracts the identity eval line this parcel's own write_role_launch_script
// change embeds (BL-1775) - never re-implemented, only re-run under a
// controlled zsh invocation so the heavy, unrelated tail of the real
// generated script (the actual agent launch) is never exercised here.
function extractIdentityEvalLine(scriptPath) {
  const text = fs.readFileSync(scriptPath, 'utf8');
  const line = text.split('\n').find((l) => l.includes('swarm_telegram_env_cli.bb'));
  assert.ok(line, `expected the generated script to embed the BL-1775 identity eval line, got:\n${text}`);
  return line.trim();
}

function runUnderZsh(home, script) {
  return spawnSync('zsh', ['-c', script], {
    encoding: 'utf8',
    env: fixtureEnv({ HOME: home, SWARMFORGE_FLEET_HOME: home }),
  });
}

function parseTelegramEnvOutput(result) {
  assert.equal(result.status, 0, `zsh run failed:\n${result.stdout}\n${result.stderr}`);
  const token = /^TELEGRAM_BOT_TOKEN=(.*)$/m.exec(result.stdout);
  const chat = /^TELEGRAM_CHAT_ID=(.*)$/m.exec(result.stdout);
  return { token: token ? token[1] : '', chat: chat ? chat[1] : '' };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a fixture home whose \.zshenv exports TELEGRAM_BOT_TOKEN "([^"]+)" and TELEGRAM_CHAT_ID "([^"]+)"$/, (ctx, token, chat) => {
    ctx.home = mkFixtureHome(ctx);
    writeZshenv(ctx.home, token, chat);
    ctx.primaryToken = token;
    ctx.primaryChat = chat;
  });

  scoped(/^the fixture home records a primary root that is not the fixture target$/, (ctx) => {
    ctx.target = mkTargetRoot(ctx, 'primary');
    recordPrimaryRoot(ctx.home, `/nonexistent/other/primary/root-${process.pid}`);
  });

  // ── Given: creds shape ───────────────────────────────────────────────
  scoped(
    /^the fixture target's swarm is named "([^"]+)" with a fleet creds file for token "([^"]+)" and chat "([^"]+)"$/,
    (ctx, swarmName, token, chat) => {
      ctx.swarmName = swarmName;
      // Rewrite the target root's conf with the real swarm name (the
      // Background already minted one for "primary" - this scenario
      // needs its own).
      ctx.target = mkTargetRoot(ctx, swarmName);
      writeFleetCreds(ctx.home, swarmName, token, chat);
      ctx.expectToken = token;
      ctx.expectChat = chat;
    }
  );

  scoped(/^the fixture target's swarm is named "([^"]+)" with no fleet creds file$/, (ctx, swarmName) => {
    ctx.swarmName = swarmName;
    ctx.target = mkTargetRoot(ctx, swarmName);
    ctx.expectToken = '';
    ctx.expectChat = '';
  });

  // ── Scenario 03's own Given (overrides the Background's record) ───────
  scoped(/^the fixture target is the recorded primary root$/, (ctx) => {
    ctx.swarmName = 'primary';
    ctx.target = mkTargetRoot(ctx, 'primary');
    recordPrimaryRoot(ctx.home, ctx.target);
    ctx.expectToken = ctx.primaryToken;
    ctx.expectChat = ctx.primaryChat;
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(
    new RegExp(`^(${[...KNOWN_PROCESSES].map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}) for the fixture target prints its Telegram environment under zsh$`),
    (ctx, process_) => {
      assert.ok(KNOWN_PROCESSES.has(process_), `unknown <process> "${process_}"`);
      if (process_ === 'a role launch script swarmforge.sh wrote') {
        const [script] = generateRoleLaunchScripts(ctx.target, ['coder']);
        const evalLine = extractIdentityEvalLine(script);
        const result = runUnderZsh(ctx.home, `${evalLine}; echo "TELEGRAM_BOT_TOKEN=\${TELEGRAM_BOT_TOKEN:-}"; echo "TELEGRAM_CHAT_ID=\${TELEGRAM_CHAT_ID:-}"`);
        ctx.seen = parseTelegramEnvOutput(result);
      } else {
        const script = `source '${SWARMFORGE_SH}' '${ctx.target}'; parse_config; apply_swarm_telegram_identity; echo "TELEGRAM_BOT_TOKEN=\${TELEGRAM_BOT_TOKEN:-}"; echo "TELEGRAM_CHAT_ID=\${TELEGRAM_CHAT_ID:-}"`;
        const result = runUnderZsh(ctx.home, script);
        ctx.seen = parseTelegramEnvOutput(result);
      }
    }
  );

  scoped(/^it sees TELEGRAM_BOT_TOKEN "([^"]*)" and TELEGRAM_CHAT_ID "([^"]*)"$/, (ctx, token, chat) => {
    assert.equal(ctx.seen.token, token, `expected TELEGRAM_BOT_TOKEN "${token}", got: ${JSON.stringify(ctx.seen)}`);
    assert.equal(ctx.seen.chat, chat, `expected TELEGRAM_CHAT_ID "${chat}", got: ${JSON.stringify(ctx.seen)}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^swarmforge\.sh writes the role launch scripts for the fixture target's pack$/, (ctx) => {
    ctx.scripts = generateRoleLaunchScripts(ctx.target, ['coder']);
  });

  scoped(/^each role launch script it wrote prints TELEGRAM_BOT_TOKEN "([^"]+)" under zsh$/, (ctx, token) => {
    assert.ok(ctx.scripts.length > 0, 'sanity: expected at least one generated script');
    for (const script of ctx.scripts) {
      const evalLine = extractIdentityEvalLine(script);
      const result = runUnderZsh(ctx.home, `${evalLine}; echo "TELEGRAM_BOT_TOKEN=\${TELEGRAM_BOT_TOKEN:-}"`);
      const seen = parseTelegramEnvOutput(result);
      assert.equal(seen.token, token, `script ${script}: expected TELEGRAM_BOT_TOKEN "${token}", got: ${JSON.stringify(seen)}`);
    }
  });

  scoped(/^the number of role launch scripts checked equals the number of roles the fixture pack names$/, (ctx) => {
    // BL-1445: a DERIVED population pins its count - read the fixture
    // target's own conf back, rather than re-stating the literal list the
    // generation step above already used.
    const confText = fs.readFileSync(path.join(ctx.target, 'swarmforge', 'swarmforge.conf'), 'utf8');
    const namedRoles = confText
      .split('\n')
      .filter((l) => l.trim().startsWith('window '))
      .map((l) => l.trim().split(/\s+/)[1]);
    assert.equal(
      ctx.scripts.length,
      namedRoles.length,
      `expected the checked script count to match the pack's own declared roles ${JSON.stringify(namedRoles)}, got ${ctx.scripts.length} script(s)`
    );
  });
}

module.exports = { registerSteps };
