'use strict';

// BL-1218: step handlers for "config remote_control decides the launched
// flag, not just the auto-inject default".
//
// Every scenario composes a REAL launch script by sourcing the REAL
// swarmforge/scripts/swarmforge.sh under zsh and calling its own
// write_role_launch_script - the same entry point the existing
// test_remote_control_launch.sh drives. Nothing here re-implements the
// composition, and the assertions read the file that actually lands on
// disk. Scenario 03 then feeds that same file to the REAL compiled
// remote_control_health_lib.bb.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS, 'swarmforge.sh');
const HEALTH_LIB = path.join(SCRIPTS, 'remote_control_health_lib.bb');

const FEATURE = 'config remote_control decides the launched flag, not just the auto-inject default';

const FLAG = '--remote-control';
const SESSION = 'SwarmForge-Coder';
const BASE_FLAGS = '--model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low';

// engineering.prompt's Scenario Outline rule: each Examples: value resolves
// through an explicit lookup, never a bare passthrough.
const KNOWN_WINDOW_LINE = {
  names: `${BASE_FLAGS} ${FLAG} ${SESSION}`,
  omits: BASE_FLAGS,
};
const KNOWN_CONFIG = {
  on: 'config remote_control on\n',
  off: 'config remote_control off\n',
};
const KNOWN_OUTCOME = {
  carries: true,
  'carries no': false,
};

function known(table, key, label) {
  if (!Object.prototype.hasOwnProperty.call(table, key)) {
    throw new Error(`unknown ${label}: ${key}`);
  }
  return table[key];
}

const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function compose(ctx, role) {
  const root = ctx.root;
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    `${ctx.configLine ?? ''}window ${role} ${ctx.agent} ${role} ${ctx.windowFlags}\n`
  );
  spawnSync(
    'zsh',
    [
      '-c',
      `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${INDEX_OF_ROLE} write_role_launch_script "$(index_of_role ${role})"`,
    ],
    {
      encoding: 'utf8',
      // swarmforge.sh is sourced from THIS repo's own swarmforge/scripts, so
      // model_factory_cli.bb's repo-root-derived default would otherwise
      // read THIS repo's real .swarmforge/model-factory/ instead of the
      // fixture's, leaking live overlay state into the composed script
      // (see test_remote_control_launch.sh / test_model_factory_runtime_wiring.sh).
      env: { ...process.env, MODEL_FACTORY_STATE_DIR: path.join(root, '.swarmforge', 'model-factory') },
    }
  );
  const script = path.join(root, '.swarmforge', 'launch', `${role}.sh`);
  assert.ok(fs.existsSync(script), `no launch script was composed for ${role}`);
  ctx.scriptPath = script;
  ctx.scriptText = fs.readFileSync(script, 'utf8');
}

function mkRoot(ctx, role) {
  ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1218-aps-'));
  fs.mkdirSync(path.join(ctx.root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(ctx.root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(ctx.root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'constitution.prompt'), 'constitution\n');
  fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = undefined;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^a Claude window line for role "(.+)"$/, (ctx, role) => {
    ctx.role = role;
    ctx.agent = 'claude';
    ctx.windowFlags = KNOWN_WINDOW_LINE.names;
    mkRoot(ctx, role);
  });

  // ── Scenario 04 ───────────────────────────────────────────────────────────
  scoped(/^a non-Claude window line for role "(.+)"$/, (ctx, role) => {
    ctx.role = role;
    ctx.agent = 'codex';
    // A non-Claude seat's line never names the flag; the point of the
    // scenario is that config on does not start adding one.
    ctx.windowFlags = '--model gpt-5-codex';
    mkRoot(ctx, role);
  });

  // ── Scenarios 01 / 02 / 03 ────────────────────────────────────────────────
  scoped(/^the window line (names|omits) a remote-control flag$/, (ctx, kind) => {
    ctx.windowFlags = known(KNOWN_WINDOW_LINE, kind, '<window_line>');
  });

  scoped(/^the pack config sets remote control to "(.+)"$/, (ctx, value) => {
    ctx.configLine = known(KNOWN_CONFIG, value, 'config value');
  });

  scoped(/^the pack config names no remote control setting$/, (ctx) => {
    ctx.configLine = '';
  });

  scoped(/^the launch script for "(.+)" is composed$/, (ctx, role) => {
    compose(ctx, role);
  });

  // Scenario 04 writes "carries no remote-control flag" while the outline's
  // substituted form reads "carries no a remote-control flag" - the article
  // belongs to the outline's template, not to the assertion. One handler
  // covers both rather than two near-identical regexes.
  scoped(/^the launch script (carries no|carries) (?:a )?remote-control flag$/, (ctx, outcome) => {
    const shouldCarry = known(KNOWN_OUTCOME, outcome, '<outcome>');
    assert.equal(
      ctx.scriptText.includes(FLAG),
      shouldCarry,
      `the persisted launch script should ${shouldCarry ? '' : 'NOT '}carry ${FLAG}`
    );
    if (!shouldCarry && ctx.agent === 'claude') {
      // Stripping the flag must not take the rest of the window line with
      // it. --model/--effort are parsed into the settings JSON (BL-319), so
      // each half is checked where it actually lands.
      assert.ok(
        ctx.scriptText.includes('--dangerously-skip-permissions'),
        'stripping the flag ate another flag from the window line'
      );
      const settings = ctx.scriptPath.replace(/\.sh$/, '.claude-settings.json');
      assert.ok(
        fs.readFileSync(settings, 'utf8').includes('claude-haiku-4-5-20251001'),
        'stripping the flag ate the model the window line named'
      );
    }
    cleanup(ctx);
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────────
  scoped(/^the remote-control health check reads that launch script$/, (ctx) => {
    const script = `
(load-file ${JSON.stringify(HEALTH_LIB)})
(let [state-dir (str ${JSON.stringify(ctx.root)} "/.swarmforge")]
  (print (pr-str {:from-script (remote-control-health/extract-rc-name (slurp ${JSON.stringify(ctx.scriptPath)}))
                  :expected (remote-control-health/expected-rc-name state-dir ${JSON.stringify(ctx.role)})})))
`;
    const result = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, `health lib failed: ${result.stderr}`);
    ctx.health = result.stdout.trim();
  });

  scoped(/^the health check reports "(.+)" as off$/, (ctx, role) => {
    assert.equal(role, ctx.role, 'the Then names a different role than the Given');
    // Two independent halves, asserted separately on purpose. expected-rc-name
    // returning nil is BL-1217's config gate and would hold even with a stale
    // script; extract-rc-name returning nil is THIS ticket - the persisted
    // script itself no longer names a flag, so script and config agree.
    assert.match(ctx.health, /:expected nil/, `the health check did not report ${role} as off: ${ctx.health}`);
    assert.match(
      ctx.health,
      /:from-script nil/,
      `the persisted script still names a remote-control session, so it disagrees with the config: ${ctx.health}`
    );
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
