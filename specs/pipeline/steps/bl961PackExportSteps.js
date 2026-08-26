'use strict';

// BL-961: step handlers for "launcher exports the resolved pack into every
// role shell". Drives the REAL write_role_launch_script in
// swarmforge/scripts/swarmforge.sh through the established zsh-source
// fixture harness (test_remote_control_launch.sh / BL-961's own shell
// test) against disposable scratch roots - no live tmux, never a
// reimplementation of the launcher.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

const FEATURE = 'BL-961 launcher exports the resolved pack into every role shell';

// Every Examples column value is validated against this explicit lookup
// and throws on anything else (the Scenario Outline rule) - never a bare
// passthrough. The pack value is DERIVED here independently (basename sans
// .conf), so a launcher that hardcodes a value cannot pass by echoing the
// table.
const CONF_EXAMPLES = {
  'packs/full-forge.conf': { pack: 'full-forge' },
  'packs/mono-router.conf': { pack: 'mono-router' },
  'swarmforge.conf': { pack: 'swarmforge' },
};

function knownConf(token) {
  if (!Object.prototype.hasOwnProperty.call(CONF_EXAMPLES, token)) {
    throw new Error(`unknown <conf> token: ${token}`);
  }
  assert.equal(
    path.basename(token, '.conf'),
    CONF_EXAMPLES[token].pack,
    'KNOWN_VALUES self-check: the table pack must be the conf basename sans .conf'
  );
  return token;
}

const KNOWN_PACKS = new Set(Object.values(CONF_EXAMPLES).map((v) => v.pack));

function knownPack(token) {
  if (!KNOWN_PACKS.has(token)) throw new Error(`unknown <pack> token: ${token}`);
  return token;
}

const KNOWN_ROLES = new Set(['coder', 'QA']);

function knownRole(token) {
  if (!KNOWN_ROLES.has(token)) throw new Error(`unknown role token: ${token}`);
  return token;
}

let trackedRoots = [];

afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

const WINDOW_LINE = (role) =>
  `window ${role} claude ${role} --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low`;

const INDEX_SNIPPET =
  'index_of_role() { local target="$1" i; for (( i = 1; i <= ${#ROLES[@]}; i++ )); do [[ "${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }; done }';

function mkFixtureRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl961-')));
  trackedRoots.push(root);
  for (const dir of ['swarmforge/roles', 'swarmforge/packs', '.swarmforge/launch', '.swarmforge/prompts']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), 'constitution\n');
  return root;
}

function writeConf(ctx) {
  const confPath = path.join(ctx.root, 'swarmforge', ctx.conf);
  fs.writeFileSync(confPath, ctx.roles.map(WINDOW_LINE).join('\n') + '\n');
  for (const role of ctx.roles) {
    fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
}

// BL-961 hardening: the acceptance run inherits the pane's environment, and
// every live role shell exports SWARMFORGE_PACK while an operator shell can
// export SWARMFORGE_CONFIG. swarmforge.sh READS both - it resolves
// CONFIG_FILE="${SWARMFORGE_CONFIG:-.../swarmforge.conf}" - so passing
// process.env straight through makes the Outline's `swarmforge.conf` row
// assert against the ambient configuration rather than its own fixture: a
// false RED when that path's basename differs, and a silent false GREEN
// whenever it is itself named swarmforge.conf, which is the default's own
// name. Strip every SWARMFORGE_* the script under test reads. Enumerated
// from `grep -o 'SWARMFORGE_[A-Z_]*' swarmforge/scripts/swarmforge.sh`;
// re-run that grep when swarmforge.sh grows a new one. The same list is
// applied by BL-961's shell test and property runner.
const SWARMFORGE_VARS_READ_BY_LAUNCHER = [
  'SWARMFORGE_ALLOW_FULL_PACK', 'SWARMFORGE_CONFIG', 'SWARMFORGE_DAEMON_START_CALLER',
  'SWARMFORGE_GEMINI_API_KEY', 'SWARMFORGE_MAILBOX_ONLY', 'SWARMFORGE_OPENROUTER_ROLES',
  'SWARMFORGE_PACK', 'SWARMFORGE_REMOTE_CONTROL', 'SWARMFORGE_ROLE',
  'SWARMFORGE_ROLE_WORKTREE', 'SWARMFORGE_SKIP_DAEMON', 'SWARMFORGE_SKIP_FRONT_DESK',
  'SWARMFORGE_SKIP_OPERATOR', 'SWARMFORGE_SKIP_SHELL_RUN_RECORD', 'SWARMFORGE_TERMINAL',
  'SWARMFORGE_TERMINAL_BACKEND', 'SWARMFORGE_USE_CEREBRAS', 'SWARMFORGE_USE_PERPLEXITY',
  'SWARMFORGE_USE_QWEN',
];

function fixtureEnv() {
  const env = { ...process.env, XDG_RUNTIME_DIR: '/tmp' };
  for (const name of SWARMFORGE_VARS_READ_BY_LAUNCHER) delete env[name];
  return env;
}

function generateScripts(ctx, roles) {
  writeConf(ctx);
  const packArg = ctx.conf.startsWith('packs/')
    ? ` --pack '${path.basename(ctx.conf, '.conf')}'`
    : '';
  const writes = roles
    .map((r) => `write_role_launch_script "$(index_of_role ${r})"`)
    .join('; ');
  execFileSync(
    'zsh',
    ['-c', `source '${SWARMFORGE_SH}' '${ctx.root}'${packArg}; parse_config; ${INDEX_SNIPPET}; ${writes}`],
    { encoding: 'utf8', env: fixtureEnv() }
  );
  return roles.map((r) => path.join(ctx.root, '.swarmforge', 'launch', `${r}.sh`));
}

function assertExportLine(script, pack) {
  assert.ok(fs.existsSync(script), `expected the launch script to exist: ${script}`);
  const lines = fs.readFileSync(script, 'utf8').split('\n');
  assert.ok(
    lines.includes(`export SWARMFORGE_PACK='${pack}'`),
    `expected the generated file itself to contain export SWARMFORGE_PACK='${pack}'; SWARMFORGE_PACK lines found: ${JSON.stringify(lines.filter((l) => l.includes('SWARMFORGE_PACK')))}`
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a scratch fixture project root with the minimal swarm layout$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    ctx.roles = ['coder'];
  });

  scoped(/^the launcher is invoked with the pack conf "([^"]+)"$/, (ctx, token) => {
    ctx.conf = knownConf(token);
  });

  scoped(/^the pack conf declares the roles "([^"]+)" and "([^"]+)"$/, (ctx, a, b) => {
    ctx.roles = [knownRole(a), knownRole(b)];
  });

  scoped(/^the launcher writes the launch script for role "([^"]+)"$/, (ctx, role) => {
    ctx.scripts = generateScripts(ctx, [knownRole(role)]);
  });

  scoped(/^the launcher writes each declared role's launch script$/, (ctx) => {
    ctx.scripts = generateScripts(ctx, ctx.roles);
  });

  scoped(/^the generated launch script contains the line "export SWARMFORGE_PACK='([^']+)'"$/, (ctx, token) => {
    assertExportLine(ctx.scripts[0], knownPack(token));
  });

  scoped(/^every generated launch script contains the line "export SWARMFORGE_PACK='([^']+)'"$/, (ctx, token) => {
    const pack = knownPack(token);
    assert.ok(ctx.scripts.length > 1, 'sanity: this assertion is about MULTIPLE roles');
    for (const script of ctx.scripts) assertExportLine(script, pack);
  });
}

module.exports = { registerSteps };
