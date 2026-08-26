'use strict';

// BL-1049: step handlers for "the tmux server's global environment carries
// only the secrets the running configuration needs".
//
// Every scenario drives the REAL pair - swarmforge/scripts/harness_env_scrub.sh
// sourced into a real bash, and swarmforge/scripts/harness_env_scrub_lib.bb
// loaded into a real bb - against a REAL throwaway tmux server whose global
// environment is seeded from the fixture shell exactly the way ./swarm's is.
// Nothing here re-states the name lists: scenario 04 reads both files, and the
// others read back what a live server actually kept.
//
// SAFETY: no step may surface a raw `tmux show-environment -g` dump. A manual
// repro of this exact scenario, run from a live harness session, put every
// real provider key on that shell's PATH into a transcript. Values are
// stripped at the point of capture (`sed 's/=.*//'`), every fixture value is
// the literal placeholder below, and assertion messages name variables only.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');
const fixtureReaper = require('./lib/fixtureReaper');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "The tmux server's global environment carries only the secrets the running configuration needs";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRUB_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'harness_env_scrub.sh');
const SCRUB_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'harness_env_scrub_lib.bb');

// Nothing in this file is a credential. Every fixture secret is this literal.
const PLACEHOLDER = 'bl1049-placeholder-not-a-real-key';

// The secrets the Background exports, so a scenario can assert about any of
// them without each one needing its own Given. Mirrors the live evidence
// block in the ticket; the authoritative list stays in the two source files
// and scenario 04 is what pins them together.
const HOST_SECRETS = [
  'BAILIAN_API_KEY', 'BAILIAN_CODING_PLAN_API_KEY', 'BAILIAN_TOKEN_PLAN_API_KEY',
  'CEREBRAS_API_KEY', 'CURSOR_API_KEY', 'DASHSCOPE_API_KEY', 'DEEPSEEK_API_KEY',
  'GEMINI_API_KEY', 'MISTRAL_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY',
  'PERPLEXITY_API_KEY', 'QWEN_API_KEY', 'RESEND_API_KEY', 'TELEGRAM_BOT_TOKEN',
];

// BL-657's deliberate passthroughs travel with the secrets so scenario 01's
// last two rows have something to observe.
const PASSTHROUGHS = { CLAUDE_CODE_OAUTH_TOKEN: PLACEHOLDER, CLAUDE_CODE_MAX_OUTPUT_TOKENS: '4096' };

// Explicit known values per the Scenario Outline handler rule: a placeholder
// the handlers do not know is a hard failure, never a passthrough.
const KNOWN_PROVIDERS = new Set(['claude', 'vibe']);
const KNOWN_OUTCOMES = new Map([
  ['does not name', false],
  ['still names', true],
]);
// Pinned separately from KNOWN_OUTCOMES/KNOWN_PROVIDERS: a "does not name"
// row's assertion is non-membership, which any garbled string satisfies
// trivially - mutating scenario 01's `variable` cell on such a row (e.g.
// OPENAI_API_KEY -> OPENAI_API_KeY) still reads "not present" and the
// mutant survives with no signal at all. Pinning `variable` against the
// exact fixture vocabulary the Background actually seeds closes that:
// a mutated cell is now an unknown value, caught before the shape lookup.
const KNOWN_VARIABLES = new Set([...HOST_SECRETS, ...Object.keys(PASSTHROUGHS)]);

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    const root = trackedRoots.pop();
    // reap() before rmSync so the fixture's tmux server is torn down, not
    // merely orphaned behind an unlinked socket. The afterEach alone cannot
    // cover an abnormal exit; fixtureReaper's exit handlers are that half.
    fixtureReaper.reap(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function mkFixture(ctx) {
  const root = mkSocketFixtureRoot('sfvc-bl1049-');
  ctx.root = root;
  ctx.sock = path.join(root, 'bl1049.sock');
  // fixtureReaper.reap() finds a fixture's tmux server ONLY via this pointer
  // file (role_lifecycle.sh's own shape) - track() alone does not teach it
  // this fixture's socket. Without it, afterEach's reap() silently no-ops
  // and every scenario that reaches "the running configuration's windows
  // all use ..." below leaks a real `sleep 120` tmux server. Written before
  // track() and well before the server is spawned, so reap() finds it even
  // if the process dies between here and the tmux new-session call.
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), ctx.sock);
  fixtureReaper.track(root);
  trackedRoots.push(root);
  return root;
}

// The launching shell the Background describes: every provider secret on the
// host, plus the harness marker BL-657 already removes, plus the deliberate
// passthroughs. A caller adds SWARMFORGE_ENV_SCRUB_CONF to point the derived
// keep-list at a fixture conf.
function launchingShellEnv(ctx) {
  const env = {
    ...process.env,
    ...PASSTHROUGHS,
    CLAUDE_CODE_CHILD_SESSION: PLACEHOLDER,
    // Cleared so a real value in the runner's own environment can never make
    // a scenario read the developer's live swarmforge.conf instead of its
    // fixture - the difference would be invisible and the scenario would
    // silently assert about the wrong configuration.
    CONFIG_FILE: '',
    SWARMFORGE_CONFIG: '',
    SWARMFORGE_OPENROUTER_ROLES: '',
  };
  for (const name of HOST_SECRETS) env[name] = PLACEHOLDER;
  // A scenario that declares no configuration still gets a deterministic
  // one: a path that does not exist, never the developer's live
  // swarmforge.conf, which would make the run depend on this machine.
  env.SWARMFORGE_ENV_SCRUB_CONF = ctx.confPath || path.join(ctx.root, 'no-such.conf');
  return env;
}

function runInLaunchingShell(ctx, script) {
  return spawnSync('bash', ['-c', `source '${SCRUB_SH}'\n${script}`], {
    encoding: 'utf8',
    env: launchingShellEnv(ctx),
  });
}

function writeConf(ctx, backend) {
  const conf = path.join(ctx.root, `${backend}-windows.conf`);
  const roles = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
  fs.writeFileSync(conf, `${roles.map((r) => `window ${r} ${backend} ${r}`).join('\n')}\n`);
  ctx.confPath = conf;
  ctx.backend = backend;
}

// Names only - values are stripped here, at the point of capture, so no
// downstream step can surface one even by accident.
const DUMP_SERVER_NAMES = (sock) => `tmux -S '${sock}' show-environment -g 2>/dev/null | sed 's/=.*//'`;

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a launching shell that exports every provider secret on the host$/, (ctx) => {
    mkFixture(ctx);
    ctx.serverStarted = false;
  });

  scoped(/^a tmux server whose global environment was seeded from that shell$/, (ctx) => {
    // Deferred on purpose: scenario 05 overrides this with "no tmux server is
    // listening", and starting one here just to kill it would be the thing
    // that scenario asserts must never happen.
    ctx.wantServer = true;
  });

  scoped(/^no tmux server is listening on the socket$/, (ctx) => {
    ctx.wantServer = false;
    assert.equal(fs.existsSync(ctx.sock), false, 'the fixture socket must not exist yet');
  });

  scoped(/^the running configuration's windows all use the "(.+)" backend$/, (ctx, provider) => {
    assert.ok(KNOWN_PROVIDERS.has(provider),
      `unknown backend "${provider}" - the handlers know ${[...KNOWN_PROVIDERS].join(', ')}`);
    writeConf(ctx, provider);
    if (ctx.wantServer && !ctx.serverStarted) {
      // Seeded from the fixture shell, which is the leak: tmux copies the
      // whole calling environment into the new server's global environment.
      const started = runInLaunchingShell(ctx,
        `tmux -S '${ctx.sock}' new-session -d -s bl1049 'sleep 120'`);
      assert.equal(started.status, 0, `the fixture tmux server did not start: ${started.stderr}`);
      ctx.serverStarted = true;
      const before = runInLaunchingShell(ctx, DUMP_SERVER_NAMES(ctx.sock)).stdout.split('\n');
      // Asserted, not assumed: without the leak actually present, every
      // "does not name" row below would pass against nothing.
      assert.ok(before.includes('OPENAI_API_KEY'),
        'the fixture server must genuinely carry the leak before the scrub');
    }
  });

  const doScrub = (ctx) => {
    const res = runInLaunchingShell(ctx, [
      `scrub_tmux_harness_env '${ctx.sock}'`,
      'printf "SCRUB_EXIT=%s\\n" "$?"',
      `printf "LAUNCHER_RESEND=%s\\n" "\${RESEND_API_KEY:-MISSING}"`,
      // A daemon forked from the launcher AFTER the scrub - handoffd's own
      // shape (plain nohup, never a tmux pane) - reading the key it needs.
      `nohup bash -c 'printf "DAEMON_RESEND=%s\\n" "\${RESEND_API_KEY:-MISSING}" > "${ctx.root}/daemon.txt"' >/dev/null 2>&1`,
      'wait',
      'echo BL1049_SERVER_DUMP_BEGIN',
      ctx.serverStarted ? DUMP_SERVER_NAMES(ctx.sock) : 'true',
    ].join('\n'));
    ctx.scrubExit = /SCRUB_EXIT=(\d+)/.exec(res.stdout);
    ctx.scrubExit = ctx.scrubExit ? Number(ctx.scrubExit[1]) : null;
    ctx.launcherResend = /LAUNCHER_RESEND=(.*)/.exec(res.stdout)?.[1] ?? null;
    // Only what is BELOW the marker is the server's own dump - the
    // diagnostic lines above it are this harness's, and counting them as
    // server variables would let scenario 05 pass or fail for the wrong
    // reason.
    const [, dump = ''] = res.stdout.split('BL1049_SERVER_DUMP_BEGIN\n');
    ctx.serverNames = dump.split('\n').map((l) => l.trim());
  };

  scoped(/^the swarm scrubs the tmux server's global environment$/, doScrub);
  scoped(/^the swarm has scrubbed the tmux server's global environment$/, doScrub);

  scoped(/^"tmux show-environment -g" (does not name|still names) "(.+)"$/, (ctx, outcome, variable) => {
    assert.ok(KNOWN_OUTCOMES.has(outcome), `unknown outcome "${outcome}"`);
    assert.ok(KNOWN_VARIABLES.has(variable),
      `unknown variable "${variable}" - the handlers know ${[...KNOWN_VARIABLES].join(', ')}`);
    const present = ctx.serverNames.includes(variable);
    assert.equal(present, KNOWN_OUTCOMES.get(outcome),
      `on an all-${ctx.backend} configuration the server ${present ? 'still names' : 'does not name'} ` +
        `${variable}, expected "${outcome}"`);
  });

  scoped(/^a role session is created on that server$/, (ctx) => {
    const out = path.join(ctx.root, 'pane.txt');
    // create_role_session's own shape: a new session on the ALREADY-scrubbed
    // server, so the pane inherits whatever the global environment now holds.
    runInLaunchingShell(ctx, [
      `tmux -S '${ctx.sock}' new-session -d -s bl1049-role ` +
        `'env | sed "s/=.*//" > "${out}"; sleep 5'`,
      `for _ in $(seq 1 20); do [ -s '${out}' ] && break; sleep 0.2; done`,
    ].join('\n'));
    assert.ok(fs.existsSync(out) && fs.statSync(out).size > 0,
      'the role pane never reported its environment');
    ctx.paneNames = fs.readFileSync(out, 'utf8').split('\n').map((l) => l.trim());
  });

  scoped(/^that pane's own environment does not name "(.+)"$/, (ctx, variable) => {
    assert.equal(ctx.paneNames.includes(variable), false,
      `a pane opened after the scrub still inherited ${variable} - the server global is what panes copy`);
  });

  scoped(/^the launcher process's own environment still names "(.+)"$/, (ctx, variable) => {
    assert.equal(variable, 'RESEND_API_KEY', `this scenario is written about RESEND_API_KEY, not ${variable}`);
    assert.equal(ctx.launcherResend, PLACEHOLDER,
      'the launcher process lost RESEND_API_KEY - only the tmux SERVER may be narrowed');
  });

  scoped(/^a daemon forked from the launcher after the scrub still reads it$/, (ctx) => {
    const daemonFile = path.join(ctx.root, 'daemon.txt');
    assert.ok(fs.existsSync(daemonFile), 'the forked daemon never reported');
    assert.equal(fs.readFileSync(daemonFile, 'utf8').trim(), `DAEMON_RESEND=${PLACEHOLDER}`,
      'handoffd forks from the launcher with plain nohup and reads RESEND_API_KEY for briefing email');
  });

  scoped(/^the scrub name set is read from the Babashka lib$/, (ctx) => {
    const res = spawnSync('bb', ['-e',
      `(load-file "${SCRUB_LIB}") (run! println (sort harness-env-scrub-lib/provider-secret-vars))`],
      { encoding: 'utf8' });
    assert.equal(res.status, 0, `reading the Babashka lib failed: ${res.stderr}`);
    ctx.libNames = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(ctx.libNames.length > 0, 'the Babashka lib named no variables at all');
  });

  scoped(/^the scrub name set is read from the shell twin$/, (ctx) => {
    const res = spawnSync('bash', ['-c',
      `source '${SCRUB_SH}'; printf '%s\\n' "\${HARNESS_ENV_PROVIDER_SECRET_VARS[@]}"`],
      { encoding: 'utf8' });
    assert.equal(res.status, 0, `reading the shell twin failed: ${res.stderr}`);
    ctx.shellNames = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(ctx.shellNames.length > 0, 'the shell twin named no variables at all');
  });

  scoped(/^the two sets name exactly the same variables$/, (ctx) => {
    assert.deepEqual([...ctx.libNames].sort(), [...ctx.shellNames].sort(),
      'a name one side scrubs and the other does not is a silent hole between the live launcher and the diagnostic CLI');
  });

  scoped(/^the scrub reports success$/, (ctx) => {
    assert.equal(ctx.scrubExit, 0,
      'scrubbing a socket no server is listening on must never abort the launch');
  });

  scoped(/^no variable is reported as removed$/, (ctx) => {
    assert.equal(fs.existsSync(ctx.sock), false,
      'the scrub started a tmux server on an unreachable socket - it must remove nothing and start nothing');
    assert.deepEqual(ctx.serverNames.filter(Boolean), [],
      'the scrub reported removals against a server that was never there');
  });
}

module.exports = { registerSteps };
