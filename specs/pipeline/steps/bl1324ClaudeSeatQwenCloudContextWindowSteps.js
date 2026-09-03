'use strict';

// BL-1324: step handlers for the BL-848 stamp-off of landed hotfix
// 4ed88430b2 ("a claude seat whose --model is qwen* gets Token Plan billing
// and a real 1M context window").
//
// This is a REVIEW parcel: every scenario confirms or refutes what the
// hotfix landed, and none of it reimplements the hotfix. Concretely:
//
//   - scenarios 01-05 and 07 source the REAL swarmforge.sh under `zsh -f`
//     (no operator profile, per the Background) and call the REAL
//     extra_cli_targets_qwen_cloud / write_role_launch_script / launch_role
//     against a throwaway fixture root, exactly the bl1052 harness shape.
//     No JS re-statement of the matcher or of the billing-guard branch
//     exists here - a reimplementation would certify itself, not the fix.
//   - the Background additionally pins the three hotfix-owned regions of
//     the working-tree swarmforge.sh byte-for-byte against their content at
//     4ed88430b2, so "the landed commit" is what these scenarios exercise
//     even though they run the checked-out file (invariant 1).
//   - scenario 06 reads the pack conf AT 4ed88430b2 via `git show`, not
//     the working tree: a LATER operator commit (441fd35112, "Restaff bob
//     BoB starting cast") moved six of the seven pipeline seats back to
//     claude-sonnet-5. That supersession is recorded in the evidence file;
//     re-pointing this scenario at the working tree would refute a hotfix
//     for a change it never made.
//   - scenario 08 reads the REAL backlog/hotfix-ledger.yaml row and asserts
//     it is still awaiting a human decision (invariant 2).
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'a claude seat whose --model is qwen* gets Token Plan billing and a real 1M context window';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const PACK_CONF_REL = 'swarmforge/packs/bob-multi-provider-mono-router.conf';

// The commit under review. Every claim this feature makes is a claim about
// THIS commit's content, never about whatever the working tree drifted to.
const HOTFIX_COMMIT = '4ed88430b2';

const TOKEN_PLAN_HOST = 'token-plan.ap-southeast-1.maas.aliyuncs.com';
const CONTEXT_VAR = 'CLAUDE_CODE_MAX_CONTEXT_TOKENS';
const FIXTURE_QWEN_KEY = 'bl1324-fixture-key-never-a-real-credential';

// Scenario Outline known values: the closed set of <extra_cli> strings the
// feature's own Examples table uses, each mapped to the expected verdict.
// An unrecognized row is a hard failure - never a passthrough check that
// would pass for any substitution (Scenario Outline handler rule).
const EXTRA_CLI_CASES = {
  '--model qwen3.8-max --effort high': true,
  '--model claude-sonnet-5 --effort high': false,
  '--effort high': false,
  // The dormant gap named in the ticket's approval_context: the matcher
  // only reads a SPACE-separated `--model` token pair, so the single-token
  // `--model=<value>` form is not detected. Pinned here as landed
  // behaviour, deliberately NOT "fixed" in this parcel (constraints).
  '--model=qwen3.8-max --effort high': false,
};

const KNOWN_RESULTS = new Set(['true', 'false']);

// Extra CLI strings the literal scenarios (02-05, 07) staff a claude seat
// with - the same closed-set discipline, since each drives a real launch.
const KNOWN_SEAT_CLIS = new Set([
  '--model qwen3.8-max --dangerously-skip-permissions --effort high',
  '--model claude-sonnet-5 --dangerously-skip-permissions --effort high',
  '--model qwen3.8-max --effort high',
]);

// Every provider credential/route variable the fixture launch must start
// clean of, so a value seen in a generated script or a pane env came from
// the code under test and not from the operator's own shell (BL-1052's
// PROVIDER_KEYS, same reason).
const PROVIDER_KEYS = [
  'QWEN_API_KEY',
  'BAILIAN_CODING_PLAN_API_KEY',
  'BAILIAN_TOKEN_PLAN_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_API_BASE',
  'OPENAI_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'OPENROUTER_API_KEY',
  'MISTRAL_API_KEY',
  'CEREBRAS_API_KEY',
  'PERPLEXITY_API_KEY',
  'GEMINI_API_KEY',
  'SWARMFORGE_GEMINI_API_KEY',
  'SWARMFORGE_USE_QWEN',
  CONTEXT_VAR,
];

const FIXTURE_PREFIX = 'bl1324-stampoff-';

function git(...args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
  });
}

function showAtHotfix(relPath) {
  return git('show', `${HOTFIX_COMMIT}:${relPath}`);
}

// The three regions the hotfix owns, each located by an anchor that exists
// in both revisions. Extracting by anchor rather than by line number keeps
// the comparison meaningful after unrelated edits move the code.
function hotfixRegions(text) {
  const lines = text.split('\n');
  const grab = (startRe, endRe, label) => {
    const start = lines.findIndex((l) => startRe.test(l));
    assert.notEqual(start, -1, `hotfix region "${label}" not found (${startRe})`);
    const rel = lines.slice(start + 1).findIndex((l) => endRe.test(l));
    assert.notEqual(rel, -1, `hotfix region "${label}" has no end (${endRe})`);
    return lines.slice(start, start + 1 + rel + 1).join('\n');
  };
  return {
    matcher: grab(/^extra_cli_targets_qwen_cloud\(\) \{$/, /^\}$/, 'extra_cli_targets_qwen_cloud'),
    billingGuard: grab(
      /extra_cli_targets_qwen_cloud "\$extra_cli"/,
      /^\s*elif role_uses_openrouter "\$role"; then$/,
      'claude billing-guard branch'
    ),
    paneEnv: grab(
      /elif \[\[ "\$agent" == "claude" \]\] && extra_cli_targets_qwen_cloud "\$\{EXTRA_CLI_ARGS\[\$index\]:-\}"/,
      /^\s*fi$/,
      'launch_role pane-env branch'
    ),
  };
}

// BL-971: a killed run traps nothing, so stale fixture roots are swept BEFORE
// a run as well as removed in a `finally` after it. The mtime guard is what
// keeps that sweep from eating a LIVE sibling root: only dirs older than this
// process are removed, so two fixtures alive at once never delete each other.
function sweepStaleFixtures() {
  const base = os.tmpdir();
  const processStart = Date.now() - Math.round(process.uptime() * 1000);
  for (const name of fs.readdirSync(base)) {
    if (!name.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(base, name);
    try {
      if (fs.statSync(full).mtimeMs >= processStart) continue;
      fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // best-effort: a concurrent run cleans up its own root
    }
  }
}

function makeFixtureRoot() {
  sweepStaleFixtures();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  fs.writeFileSync(path.join(root, 'swarmforge', 'roles', 'coder.prompt'), 'role prompt\n');
  return root;
}

function fixtureEnv(overrides = {}) {
  const env = { ...process.env };
  for (const name of PROVIDER_KEYS) {
    delete env[name];
  }
  // The seat under review is deliberately not steward-cleared in a
  // throwaway fixture; the staffing gate (BL-1318) is a different gate and
  // must not decide this review's verdict.
  env.PACK_STAFFING_SKIP_GATE = '1';
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete env[k];
    } else {
      env[k] = v;
    }
  }
  return env;
}

// `zsh -f` = no operator profile (the Background's precondition): a
// ~/.zshenv that re-exports real provider keys must never reach a fixture
// launch (see the zshenv incident behind PROVIDER_KEYS above).
function zshEval(root, body, env) {
  return spawnSync('zsh', ['-f', '-c', `source '${SWARMFORGE_SH}' '${root}'; ${body}`], {
    encoding: 'utf8',
    env,
  });
}

function callMatcher(extraCli) {
  const root = makeFixtureRoot();
  try {
    const r = zshEval(
      root,
      `extra_cli_targets_qwen_cloud ${JSON.stringify(extraCli)} && echo MATCH_TRUE || echo MATCH_FALSE`,
      fixtureEnv()
    );
    const out = `${r.stdout}${r.stderr}`;
    if (/MATCH_TRUE/.test(out)) return true;
    if (/MATCH_FALSE/.test(out)) return false;
    throw new Error(`extra_cli_targets_qwen_cloud produced no verdict: ${out}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeConf(root, extraCli) {
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    `config active_backlog_max_depth -1\nwindow coder claude coder ${extraCli}\n`
  );
}

// Generates the REAL .swarmforge/launch/coder.sh for a claude seat with the
// given extra CLI. write_role_launch_script's tail touches a terminal
// adapter that a bare `zsh -f` has not sourced; the launch script is fully
// written before that point, so the file - not the exit status - is the
// artifact under review, and its absence is the real failure.
function buildLaunchScript(extraCli, env) {
  const root = makeFixtureRoot();
  try {
    writeConf(root, extraCli);
    const r = zshEval(root, 'parse_config; write_role_launch_script 1 >/dev/null', env);
    const script = path.join(root, '.swarmforge', 'launch', 'coder.sh');
    assert.ok(
      fs.existsSync(script),
      `no launch script was generated for "${extraCli}": ${r.stdout}${r.stderr}`
    );
    return fs.readFileSync(script, 'utf8');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Drives the REAL launch_role with tmux faked to a logger, so the
// respawn-pane `-e` flags (the pane env) can be read exactly as tmux would
// have received them. Nothing here inspects provider_env_flags directly -
// that array is a local of launch_role and its observable form IS the
// respawn-pane command line.
function buildPaneEnv(extraCli, env) {
  const root = makeFixtureRoot();
  const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${FIXTURE_PREFIX}tmux-`)));
  const logPath = path.join(bin, 'tmux-calls.log');
  try {
    fs.writeFileSync(path.join(bin, 'tmux'), '#!/usr/bin/env bash\necho "$@" >> "$TMUX_LOG"\nexit 0\n');
    fs.chmodSync(path.join(bin, 'tmux'), 0o755);
    writeConf(root, extraCli);
    const childEnv = { ...env, PATH: `${bin}${path.delimiter}${env.PATH || ''}`, TMUX_LOG: logPath };
    const r = zshEval(root, 'parse_config; choose_cleanup_owner; launch_role 1', childEnv);
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    const respawn = log.split('\n').filter((l) => /\brespawn-pane\b/.test(l));
    assert.equal(
      respawn.length,
      1,
      `expected exactly one respawn-pane for the seat: ${JSON.stringify(respawn)}\n${r.stdout}${r.stderr}`
    );
    return respawn[0];
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
}

function packWindowLines(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('window '));
}

function ledgerRowFor(commit) {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml'), 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `- commit: ${commit}`);
  assert.notEqual(start, -1, `no hotfix-ledger row for commit ${commit}`);
  const row = {};
  for (const line of lines.slice(start, start + 12)) {
    const m = /^\s*-?\s*([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === 'commit' && row.commit) break;
    row[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return row;
}

// The hotfix's own lines must all still be there, in order. Anything the
// current region has ON TOP of them is a later, attributable addition (it has
// to carry a BL-#### marker of its own); anything MISSING is the drift this
// pin exists to catch.
function assertHotfixLinesIntact(currentRegion, landedRegion, key) {
  const current = String(currentRegion).split('\n');
  const landedLines = String(landedRegion).split('\n');
  let cursor = 0;
  for (const line of landedLines) {
    const found = current.indexOf(line, cursor);
    assert.notEqual(
      found,
      -1,
      `the "${key}" region lost or reworded a line the hotfix landed at ${HOTFIX_COMMIT}; ` +
        `this review would certify a different change. Missing: ${JSON.stringify(line)}`
    );
    cursor = found + 1;
  }
  // Anything the region has ON TOP of the hotfix's own lines must be claimed
  // by a later ticket: the region has to name one. That is the attributable
  // half - which ticket added this - while the loop above is the protective
  // half - nothing the hotfix landed may vanish or be reworded. A per-line
  // marker check was tried first and was wrong: a multi-line comment block
  // carries its BL-#### id on one line only, so every continuation line read
  // as unclaimed.
  const added = current.filter((line) => !landedLines.includes(line) && line.trim().length > 0);
  if (added.length > 0) {
    assert.ok(
      added.some((line) => /BL-\d{3,4}/.test(line)) || current.some((line) => /BL-\d{3,4}/.test(line)),
      `the "${key}" region grew ${added.length} line(s) that no ticket claims: ${JSON.stringify(added.slice(0, 3))}`
    );
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^swarmforge\.sh's launch helpers are sourced with no operator profile$/, (ctx) => {
    // Pin the review to the landed commit: the three hotfix-owned regions
    // must still SAY what they said at 4ed88430b2, so these scenarios cannot
    // silently certify a later change.
    //
    // BL-1328: the pin used to be byte-exact, which made it forbid ANY later
    // edit to these regions - including the follow-up the same human ruling
    // on this ticket authorized ("mint a narrow follow-up to match the
    // --model=<value> single-token form"). Measured: 11 pass / 0 fail before
    // that follow-up, 0 pass / 11 fail after, every scenario failing here.
    // A landed stamp-off's harness must not freeze the file it reviewed.
    //
    // What the pin keeps: every line the hotfix itself contributed must still
    // be present, in order, in the current region. A later ticket may ADD to
    // the region (and must mark what it added with its own BL-#### id, so the
    // addition is attributable); it may not remove or reword a hotfix line.
    const landed = hotfixRegions(showAtHotfix('swarmforge/scripts/swarmforge.sh'));
    const current = hotfixRegions(fs.readFileSync(SWARMFORGE_SH, 'utf8'));
    for (const key of Object.keys(landed)) {
      assertHotfixLinesIntact(current[key], landed[key], key);
    }
    ctx.profileFree = true;
    ctx.env = fixtureEnv();
  });

  scoped(/^a role's extra CLI args string is "([^"]*)"$/, (ctx, extraCli) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(EXTRA_CLI_CASES, extraCli),
      `unknown <extra_cli> row "${extraCli}" - the handlers know ${JSON.stringify(Object.keys(EXTRA_CLI_CASES))}`
    );
    ctx.extraCli = extraCli;
  });

  scoped(/^extra_cli_targets_qwen_cloud is called with that string$/, (ctx) => {
    ctx.matcherResult = callMatcher(ctx.extraCli);
  });

  scoped(/^it returns (true|false)$/, (ctx, expected) => {
    assert.ok(KNOWN_RESULTS.has(expected), `unknown <result> "${expected}"`);
    assert.equal(
      EXTRA_CLI_CASES[ctx.extraCli],
      expected === 'true',
      `the Examples table's expected result for "${ctx.extraCli}" disagrees with the handler's known-value table`
    );
    assert.equal(
      ctx.matcherResult,
      expected === 'true',
      `extra_cli_targets_qwen_cloud("${ctx.extraCli}") returned ${ctx.matcherResult}`
    );
  });

  scoped(/^a claude role's extra CLI is "([^"]*)"$/, (ctx, extraCli) => {
    assert.ok(
      KNOWN_SEAT_CLIS.has(extraCli),
      `unknown seat CLI "${extraCli}" - the handlers know ${JSON.stringify([...KNOWN_SEAT_CLIS])}`
    );
    ctx.seatCli = extraCli;
    ctx.env = ctx.env || fixtureEnv();
  });

  scoped(/^SWARMFORGE_USE_QWEN is not set$/, (ctx) => {
    ctx.env = fixtureEnv({ ...ctx.envOverrides, SWARMFORGE_USE_QWEN: undefined });
    ctx.globalFlag = 'unset';
  });

  scoped(/^SWARMFORGE_USE_QWEN is set to "([^"]*)"$/, (ctx, value) => {
    assert.equal(value, '1', `only the opt-in value "1" is meaningful here, got "${value}"`);
    ctx.env = fixtureEnv({ ...ctx.envOverrides, SWARMFORGE_USE_QWEN: value });
    ctx.globalFlag = `set=${value}`;
  });

  scoped(new RegExp(`^${CONTEXT_VAR} is already exported as "([^"]*)"$`), (ctx, value) => {
    assert.match(value, /^\d+$/, `a context-token override must be a token count, got "${value}"`);
    ctx.envOverrides = { [CONTEXT_VAR]: value };
    ctx.contextOverride = value;
    ctx.env = fixtureEnv(ctx.envOverrides);
  });

  scoped(/^a QWEN_API_KEY credential is available$/, (ctx) => {
    ctx.envOverrides = { ...(ctx.envOverrides || {}), QWEN_API_KEY: FIXTURE_QWEN_KEY };
    ctx.env = fixtureEnv({
      ...ctx.envOverrides,
      SWARMFORGE_USE_QWEN: ctx.globalFlag === 'unset' ? undefined : ctx.env.SWARMFORGE_USE_QWEN,
    });
  });

  scoped(/^the role's billing guard is built$/, (ctx) => {
    assert.ok(ctx.seatCli, 'no seat CLI was staged');
    ctx.launchScript = buildLaunchScript(ctx.seatCli, ctx.env);
  });

  scoped(/^the billing guard maps ANTHROPIC_\* onto the Token Plan Anthropic-compat endpoint$/, (ctx) => {
    assert.match(
      ctx.launchScript,
      /qwen_guard_map_anthropic_compat \|\| exit 1/,
      'the generated launch script does not invoke the Token Plan Anthropic-compat mapping'
    );
    assert.doesNotMatch(
      ctx.launchScript,
      /unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN/,
      'the seat still falls through to the first-party subscription-auth branch'
    );
    // BL-130: the mapping is a library call, never a key value baked into a
    // file under the working directory.
    assert.ok(
      !ctx.launchScript.includes(FIXTURE_QWEN_KEY),
      'a credential VALUE reached the generated launch script (BL-130)'
    );
  });

  scoped(new RegExp(`^the billing guard exports ${CONTEXT_VAR}$`), (ctx) => {
    assert.match(
      ctx.launchScript,
      new RegExp(`export ${CONTEXT_VAR}="\\$\\{${CONTEXT_VAR}:-1000000\\}"`),
      `the guard does not export ${CONTEXT_VAR} with the 1000000 default`
    );
  });

  scoped(/^the billing guard does not map onto the Token Plan endpoint$/, (ctx) => {
    assert.doesNotMatch(
      ctx.launchScript,
      /qwen_guard_map_anthropic_compat/,
      'a sibling non-qwen claude seat was remapped onto Token Plan (invariant 3)'
    );
    assert.ok(
      !ctx.launchScript.includes(TOKEN_PLAN_HOST),
      'a sibling non-qwen claude seat names the Token Plan host (invariant 3)'
    );
    assert.match(
      ctx.launchScript,
      /unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN/,
      'the sibling seat lost its first-party subscription-auth guard'
    );
  });

  scoped(new RegExp(`^the exported ${CONTEXT_VAR} remains "([^"]*)"$`), (ctx, expected) => {
    assert.equal(expected, ctx.contextOverride, 'the scenario asserts a value it never exported');
    // The guard line is a `:-` default, so an already-exported value wins.
    // Prove that against the REAL generated script rather than by reading
    // the default expression: run the guard's own export line under the
    // pre-set value and read back what survives.
    const line = ctx.launchScript
      .split('\n')
      .find((l) => l.startsWith(`export ${CONTEXT_VAR}=`));
    assert.ok(line, `the generated script exports no ${CONTEXT_VAR}`);
    const r = spawnSync('zsh', ['-f', '-c', `${line}\nprintf '%s' "$${CONTEXT_VAR}"`], {
      encoding: 'utf8',
      env: fixtureEnv({ [CONTEXT_VAR]: expected }),
    });
    assert.equal(r.status, 0, `evaluating the guard's export line failed: ${r.stderr}`);
    assert.equal(
      r.stdout,
      expected,
      `the guard overwrote an operator-set ${CONTEXT_VAR} (${r.stdout} != ${expected})`
    );
  });

  scoped(/^launch_role builds the pane env flags for that role$/, (ctx) => {
    assert.ok(ctx.seatCli, 'no seat CLI was staged');
    ctx.respawnCommand = buildPaneEnv(ctx.seatCli, ctx.env);
  });

  scoped(/^the pane env flags carry QWEN_API_KEY$/, (ctx) => {
    assert.match(
      ctx.respawnCommand,
      new RegExp(`-e QWEN_API_KEY=${FIXTURE_QWEN_KEY}`),
      `the pane env carries no QWEN_API_KEY: ${ctx.respawnCommand}`
    );
  });

  scoped(new RegExp(`^the pane env flags carry ${CONTEXT_VAR}$`), (ctx) => {
    assert.match(
      ctx.respawnCommand,
      new RegExp(`-e ${CONTEXT_VAR}=1000000`),
      `the pane env carries no ${CONTEXT_VAR}: ${ctx.respawnCommand}`
    );
  });

  scoped(/^the bob-multi-provider-mono-router pack configuration$/, (ctx) => {
    // AT the reviewed commit - see the module header on 441fd35112.
    ctx.packText = showAtHotfix(PACK_CONF_REL);
  });

  scoped(/^the pack's window lines are read$/, (ctx) => {
    ctx.packWindows = packWindowLines(ctx.packText);
    assert.ok(ctx.packWindows.length > 0, 'the pack declares no window lines');
  });

  scoped(/^every pipeline role's window line requests --model qwen3\.8-max via the claude agent$/, (ctx) => {
    for (const line of ctx.packWindows) {
      const fields = line.split(/\s+/);
      const [, role, agent] = fields;
      assert.equal(agent, 'claude', `pipeline seat "${role}" is not staffed on the claude agent: ${line}`);
      assert.match(
        line,
        /--model qwen3\.8-max\b/,
        `pipeline seat "${role}" does not request qwen3.8-max: ${line}`
      );
    }
  });

  scoped(/^the coordinator's window line requests claude-sonnet-5$/, (ctx) => {
    // The coordinator is reserved infrastructure: it is a `config` line, not
    // a window line, which is exactly why it stays on first-party Anthropic
    // Max while every window seat moved to Token Plan.
    assert.ok(
      !ctx.packWindows.some((l) => /^window\s+coordinator\b/.test(l)),
      'the coordinator must not be staffed as a pipeline window seat'
    );
    const coordinatorModel = ctx.packText
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('config coordinator_model '));
    assert.equal(
      coordinatorModel,
      'config coordinator_model claude-sonnet-5',
      `the coordinator is not on claude-sonnet-5: ${coordinatorModel}`
    );
  });

  scoped(
    new RegExp(`^the review records that a seat under the global SWARMFORGE_USE_QWEN=1 flag also declares ${CONTEXT_VAR}$`),
    (ctx) => {
      assert.equal(ctx.globalFlag, 'set=1', 'this scenario must run with the global flag set');
      // The declaration lives on the SHARED Token Plan compat branch, so it
      // reaches every global-flag pack, not only a lone qwen*-targeted seat.
      assert.match(
        ctx.launchScript,
        new RegExp(`export ${CONTEXT_VAR}="\\$\\{${CONTEXT_VAR}:-1000000\\}"`),
        `a global-flag seat does not declare ${CONTEXT_VAR}`
      );
      assert.match(ctx.launchScript, /qwen_guard_map_anthropic_compat \|\| exit 1/);
    }
  );

  scoped(/^that behaviour is left as the commit landed it$/, (ctx) => {
    // Reported, not undone (ticket constraints): the shared branch at HEAD
    // is byte-identical to the shared branch at 4ed88430b2. The Background
    // already pinned this; asserting it again here is what makes "left as
    // landed" an assertion rather than a comment.
    // BL-1328: "left as landed" means every line the hotfix put on this
    // branch is still there, not that no later ticket may ever comment on it
    // - BL-1328 documents the precedence asymmetry here under its own marker,
    // which is an addition, not an alteration.
    const landed = hotfixRegions(showAtHotfix('swarmforge/scripts/swarmforge.sh')).billingGuard;
    const current = hotfixRegions(fs.readFileSync(SWARMFORGE_SH, 'utf8')).billingGuard;
    assertHotfixLinesIntact(current, landed, 'claude billing-guard branch');
    assert.ok(ctx.launchScript, 'no launch script was built for this scenario');
  });

  scoped(/^the review completes with every scenario green$/, (ctx) => {
    // Reaching this step means the preceding scenarios ran; the point of
    // the scenario is that being green changes nothing about the ledger.
    ctx.reviewGreen = true;
  });

  scoped(
    new RegExp(`^the hotfix ledger entry for commit ${HOTFIX_COMMIT} is still awaiting a human decision$`),
    (ctx) => {
      assert.ok(ctx.reviewGreen, 'the review-completed step must run first');
      const row = ledgerRowFor(HOTFIX_COMMIT);
      assert.ok(
        !['certified', 'waived'].includes(row.state),
        `the ledger row was written to "${row.state}" without a recorded human decision (invariant 2)`
      );
      assert.equal(row.human_decision, 'null', `human_decision is "${row.human_decision}", not null`);
      assert.equal(row.decided_at, 'null', `decided_at is "${row.decided_at}", not null`);
      assert.equal(row.stamp_ticket, 'BL-1324', 'the ledger row no longer links this stamp-off ticket');
    }
  );
}

module.exports = { registerSteps };
