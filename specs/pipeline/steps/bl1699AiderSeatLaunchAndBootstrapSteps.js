'use strict';

// BL-1699: step handlers for "aider seats launch with a short role note, no
// repo paths and the seat test loop". Drives the REAL generators - the
// aider-bootstrap-text chain and bootstrap-steps through Babashka
// (agent_runtime_cli.bb / agent_runtime_lib.bb), swarmforge.sh's own
// write_role_launch_script through zsh against a throwaway fixture root
// (BL-1052's own pattern), and the real `seat` script plus a throwaway git
// checkout carrying the real local_parcel_driver_cli.bb/lib.bb closure for
// scenario 05's driver-record fallback. No step re-implements any of these
// generators in JS.
//
// Scenario 06's "byte-identical to what the same pack produced before this
// ticket" runs the SAME generators twice: once against this checkout's
// current code, once against `main`'s pre-ticket blobs (fetched via `git
// show`, never a re-derived copy) - a real regeneration, not a captured
// snapshot that would rot the moment this ticket lands.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
// BL-1636: every throwaway root this file mkdtemps goes through the shared
// helper (registers it for reaping) rather than a bare fs.mkdtempSync -
// this file also removes each root itself via ctx.__disposables the moment
// its scenario ends (real cleanup, not a marker for its own sake).
const { mkTmpDir } = require('../../../extension/test/helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const AGENT_RUNTIME_CLI = path.join(SCRIPTS_DIR, 'agent_runtime_cli.bb');
const AGENT_RUNTIME_LIB = path.join(SCRIPTS_DIR, 'agent_runtime_lib.bb');

const FEATURE = 'BL-1699 aider seats launch with a short role note, no repo paths and the seat test loop';

const AIDER_ROLES = new Set(['coder', 'QA', 'coordinator']);
const AIDER_MODEL_FLAGS = '--model openai/qwen2.5-coder:latest --openai-api-base http://127.0.0.1:11434/v1 --no-gitignore';

// ── Scenario 01: repo-path / scripts-basename leak check (same predicate
// shape as the coder-authored property test for this ticket's invariant 1,
// duplicated here deliberately - this file drives three KNOWN roles via
// Gherkin, the property test drives a generated population). ────────────
function gitLines(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

// BL-1636/module-load-budget guard: no step handler file spawns a process
// at require time - the forbidden-word set is computed lazily, on first
// use by a running scenario, and cached from then on.
//
// QA bounce D2 (2026-09-25): whole-word match against every tracked path,
// every directory prefix of one, and every swarmforge/scripts basename -
// no length floor, and directories (never just files) are in the set.
// aider's own file-mention rule adds a reply WORD that exactly equals one
// of these, never a substring; the prior length-floor/files-only version
// missed "swarm" (5 chars, a tracked file), "seat" (4 chars, a scripts
// basename) and "backlog"/"scripts" (directories, never listed at all).
let _forbiddenWords;
function forbiddenWords() {
  if (!_forbiddenWords) {
    const repoPaths = gitLines(['ls-files']);
    const scriptsBasenames = gitLines(['ls-files', 'swarmforge/scripts']).map((p) => path.basename(p));
    const dirPrefixes = new Set();
    for (const p of repoPaths) {
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i += 1) {
        dirPrefixes.add(parts.slice(0, i).join('/'));
      }
    }
    _forbiddenWords = new Set([...repoPaths, ...scriptsBasenames, ...dirPrefixes]);
  }
  return _forbiddenWords;
}

function textWords(text) {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\w./-]+/, '').replace(/[^\w./-]+$/, ''))
    .filter(Boolean);
}

function forbiddenHit(text) {
  const words = forbiddenWords();
  for (const word of textWords(text)) {
    if (words.has(word)) {
      return { kind: 'forbidden word', value: word };
    }
  }
  return null;
}

function aiderBootstrapText(role) {
  return execFileSync('bb', [AGENT_RUNTIME_CLI, 'bootstrap-text', 'aider', role], { encoding: 'utf8' });
}

// ── Fixture root builder for swarmforge.sh's write_role_launch_script
// (BL-1052's own composeLaunchScript pattern). ─────────────────────────────
const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function mkFixtureRoot() {
  const root = fs.realpathSync(mkTmpDir('bl1699-launch-'));
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  // A Claude window's launch line embeds its whole bootstrap prompt at
  // generation time (:bootstrap-style :embedded); write_role_launch_script
  // refuses when constitution.prompt or a staffed role's own role prompt is
  // missing (a pack-staffing sanity check, unrelated to this ticket), even
  // though none of this ticket's own scenarios read either's content.
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['coder', 'QA', 'coordinator', 'specifier']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

function writeAiderNotes(root) {
  const dir = path.join(root, 'swarmforge', 'roles', 'aider');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'coder.note'), 'coder note\n');
  fs.writeFileSync(path.join(dir, 'generic.note'), 'generic note\n');
}

function packConf({ timeoutSeconds } = {}) {
  const lines = [];
  if (timeoutSeconds) lines.push(`config aider_timeout_seconds ${timeoutSeconds}`);
  // BL-319: the coordinator's own agent is a `config` directive, never a
  // `window coordinator ...` line - swarmforge.sh refuses that as reserved
  // infrastructure it always provisions itself.
  lines.push('config coordinator_agent aider');
  lines.push(`window coder aider coder ${AIDER_MODEL_FLAGS}`);
  lines.push(`window QA aider QA ${AIDER_MODEL_FLAGS}`);
  lines.push(
    'window specifier claude specifier --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low'
  );
  return lines.join('\n') + '\n';
}

function generateLaunchScript({ root, confText, role, swarmforgeShPath = SWARMFORGE_SH }) {
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), confText);
  execFileSync(
    'zsh',
    [
      '-f',
      '-c',
      `source '${swarmforgeShPath}' '${root}'; parse_config; ${INDEX_OF_ROLE} write_role_launch_script "$(index_of_role ${role})"`,
    ],
    { encoding: 'utf8', env: { ...process.env, PACK_STAFFING_SKIP_GATE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return fs.readFileSync(path.join(root, '.swarmforge', 'launch', `${role}.sh`), 'utf8');
}

function bootstrapStepsFor(agent, role, libPath) {
  const out = execFileSync(
    'bb',
    ['-e', `(load-file "${libPath}") (println (pr-str (agent-runtime-lib/bootstrap-steps "${agent}" "${role}")))`],
    { encoding: 'utf8' }
  );
  return out.trim();
}

// ── `main`'s pre-ticket blobs, fetched once and cached for scenario 06 -
// never re-derived, never a hand-copied snapshot that could drift from
// what `main` actually held. ────────────────────────────────────────────
// swarmforge.sh sources a handful of siblings by $SCRIPT_DIR-relative path
// (harness_env_scrub.sh, project_socket_id_lib.sh, ...) unconditionally at
// load time, and prompt_engine_lib.bb's own load-file chain resolves
// relative to wherever IT physically sits - so "main's swarmforge/scripts"
// means the whole directory, extracted once via `git archive`, never a
// hand-picked file list that silently rots as main grows new siblings.
// Self-healing: this repo's live swarm daemons (handoffd, operator_runtime,
// ...) run concurrently with this acceptance run on a shared host and sweep
// /tmp on their own schedules. A cached root that vanishes out from under a
// LATER call (however that happens) is re-extracted rather than handed back
// as a stale, now-missing path - re-extraction is cheap (one `git archive`)
// and every caller already treats this as "the current copy of main's
// scripts", never a specific inode to remember past its own existence.
let _mainScriptsDir;
function mainScriptsDir() {
  if (!_mainScriptsDir || !fs.existsSync(_mainScriptsDir)) {
    const dir = mkTmpDir('bl1699-main-scripts-');
    const archive = execFileSync('git', ['archive', 'main', 'swarmforge/scripts'], {
      cwd: REPO_ROOT,
      maxBuffer: 1024 * 1024 * 64,
    });
    execFileSync('tar', ['-x', '-C', dir], { input: archive });
    _mainScriptsDir = path.join(dir, 'swarmforge', 'scripts');
  }
  return _mainScriptsDir;
}

function mainSwarmforgeShPath() {
  return path.join(mainScriptsDir(), 'swarmforge.sh');
}

function mainAgentRuntimeLibPath() {
  return path.join(mainScriptsDir(), 'agent_runtime_lib.bb');
}

// The two code copies necessarily live at different $SCRIPT_DIR paths (this
// checkout's real swarmforge/scripts vs main's git-archive extraction) - a
// launch script embeds that path verbatim (mailbox_dir.bb, the qwen guard
// source line, ...). Normalizing both occurrences to one placeholder before
// comparing keeps the check honest: only a REAL content difference fails it.
function normalizeScriptDir(text) {
  return text.split(SCRIPTS_DIR).join('<SCRIPT_DIR>').split(mainScriptsDir()).join('<SCRIPT_DIR>');
}

// ── Scenario 05 fixture: the real `seat` script plus the real
// local_parcel_driver_cli.bb/lib.bb load-file closure, copied verbatim into
// a throwaway git checkout (BL-1696/1697/1698's own convention) so `seat
// test`'s own subprocess call to test-scope runs the REAL chain, never a
// re-implementation of it. ─────────────────────────────────────────────
const DRIVER_CLOSURE_FILES = [
  'seat',
  'backlog_depth_conf_path_cli.bb',
  'backlog_depth_lib.bb',
  'swarm_identity_lib.bb',
  'daemon_cycle_guard_lib.bb',
  'local_parcel_driver_cli.bb',
  'local_parcel_driver_lib.bb',
  'agent_runtime_inject.bb',
  'required_stages_lib.bb',
  'agent_runtime_lib.bb',
  'prompt_engine_lib.bb',
];

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function makeSeatTestScopeFixture() {
  const root = fs.realpathSync(mkTmpDir('bl1699-seat-test-'));
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'local-driver'), { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'bl1699-fixture@example.test']);
  git(root, ['config', 'user.name', 'BL-1699 Fixture']);

  for (const name of DRIVER_CLOSURE_FILES) {
    const src = path.join(SCRIPTS_DIR, name);
    const dest = path.join(scriptsDir, name);
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, fs.statSync(src).mode);
  }

  fs.writeFileSync(
    path.join(root, '.swarmforge', 'local-driver', 'coder.json'),
    JSON.stringify({ ticket: 'BL-9', acceptancePath: 'specs/features/BL-9-thing.feature' })
  );

  const logPath = path.join(root, 'seat-test-env.log');
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    `config seat_test_command printf 'SEAT_TICKET=%s\\nSEAT_ACCEPTANCE=%s\\n' "$SEAT_TICKET" "$SEAT_ACCEPTANCE" > '${logPath}'\n`
  );
  fs.writeFileSync(path.join(root, '.gitignore'), 'seat-test-env.log\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);

  return { root, scriptsDir, logPath };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a pack whose coder, QA and coordinator seats run aider and whose specifier seat runs Claude$/, () => {
    // No state to capture: packConf() above IS this pack, generated fresh
    // per fixture so every scenario gets an unshared throwaway root.
  });

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  scoped(/^the bootstrap text for the "([^"]+)" seat is composed$/, (ctx, role) => {
    ctx.role = role;
    ctx.bootstrapText = aiderBootstrapText(role);
  });

  scoped(
    /^it contains no path under the repository, no pipeline script name and no line telling the model to reply with "!"$/,
    (ctx) => {
      const hit = forbiddenHit(ctx.bootstrapText);
      assert.equal(
        hit,
        null,
        `role "${ctx.role}": leaked ${hit && hit.kind} "${hit && hit.value}" in bootstrap text: ${ctx.bootstrapText}`
      );
      assert.ok(
        !ctx.bootstrapText.includes('`!`'),
        `role "${ctx.role}": bootstrap text still tells the model to reply with "!": ${ctx.bootstrapText}`
      );
    }
  );

  // ── Scenarios 02 / 06 (shared When - role determines aider vs claude) ──
  scoped(/^the "([^"]+)" seat's launch line and bootstrap steps are generated$/, (ctx, role) => {
    ctx.role = role;
    ctx.__disposables = ctx.__disposables || [];
    const agent = AIDER_ROLES.has(role) ? 'aider' : 'claude';
    ctx.agent = agent;

    const root = mkFixtureRoot();
    ctx.__disposables.push(() => fs.rmSync(root, { recursive: true, force: true }));
    writeAiderNotes(root);
    ctx.launchScript = generateLaunchScript({ root, confText: packConf(), role });
    ctx.noteFilePath = path.join(root, 'swarmforge', 'roles', 'aider', `${role}.note`);
    if (!fs.existsSync(ctx.noteFilePath)) {
      ctx.noteFilePath = path.join(root, 'swarmforge', 'roles', 'aider', 'generic.note');
    }
    ctx.bootstrapStepsText = bootstrapStepsFor(agent, role, AGENT_RUNTIME_LIB);

    // main's pre-ticket regeneration - only scenario 06's Then step reads
    // these, but computing them unconditionally keeps this the ONE shared
    // driver for both scenarios (BL-1696's "no step re-implements a
    // capability" - a second, scenario-specific When step would just be
    // this same code with an if). Regenerated into the SAME root (not a
    // second throwaway one): the fixture root's own path is embedded
    // verbatim in the launch script (cd, PATH, --settings, ...), so two
    // different roots would make an unrelated path substitute for a real
    // regression. main's scripts necessarily live at a DIFFERENT
    // $SCRIPT_DIR than this checkout's own (that's the whole point - it's
    // a separate code copy), so that one absolute-path component is
    // normalized to a shared placeholder before comparing; that path
    // appearing verbatim is never itself the invariant.
    ctx.launchScriptBefore = normalizeScriptDir(
      generateLaunchScript({ root, confText: packConf(), role, swarmforgeShPath: mainSwarmforgeShPath() })
    );
    ctx.launchScript = normalizeScriptDir(ctx.launchScript);
    ctx.bootstrapStepsTextBefore = bootstrapStepsFor(agent, role, mainAgentRuntimeLibPath());
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the launch line loads the coder's aider role note with --read$/, (ctx) => {
    assert.ok(
      ctx.launchScript.includes(`--read '${ctx.noteFilePath}'`),
      `expected --read '${ctx.noteFilePath}' in launch script:\n${ctx.launchScript}`
    );
  });

  scoped(/^no bootstrap step adds the constitution, the pipeline or a role prompt file to the chat$/, (ctx) => {
    assert.ok(
      !/\/add\b/.test(ctx.bootstrapStepsText),
      `bootstrap steps still /add a file: ${ctx.bootstrapStepsText}`
    );
    assert.ok(
      !ctx.bootstrapStepsText.includes(':send-literal'),
      `bootstrap steps still carry a :send-literal op (the old /add-files-then-paste shape): ${ctx.bootstrapStepsText}`
    );
  });

  // ── Scenario 03 (Outline) ────────────────────────────────────────────
  scoped(/^the "([^"]+)" seat's launch line is generated$/, (ctx, role) => {
    ctx.role = role;
    ctx.__disposables = ctx.__disposables || [];
    const root = mkFixtureRoot();
    ctx.__disposables.push(() => fs.rmSync(root, { recursive: true, force: true }));
    writeAiderNotes(root);
    const confText = ctx.aiderTimeoutSeconds ? packConf({ timeoutSeconds: ctx.aiderTimeoutSeconds }) : packConf();
    ctx.launchScript = generateLaunchScript({ root, confText, role });
  });

  const HAS_TEST_LOOP = { carries: true, 'carries no': false };
  scoped(
    /^the launch line (carries|carries no) a --test-cmd that runs the seat test verb and --auto-test$/,
    (ctx, has) => {
      assert.ok(
        Object.prototype.hasOwnProperty.call(HAS_TEST_LOOP, has),
        `unknown Examples cell "${has}"`
      );
      const expected = HAS_TEST_LOOP[has];
      const hasFlags =
        ctx.launchScript.includes("--test-cmd 'swarmforge/scripts/seat test'") &&
        ctx.launchScript.includes('--auto-test');
      assert.equal(
        hasFlags,
        expected,
        `role "${ctx.role}": expected test-loop flags present=${expected}, launch script:\n${ctx.launchScript}`
      );
    }
  );

  // ── Scenario 04 (Outline) ────────────────────────────────────────────
  scoped(/^the pack declares an aider timeout of (\d+) s$/, (ctx, seconds) => {
    ctx.aiderTimeoutSeconds = Number(seconds);
  });

  scoped(/^the pack declares no aider timeout$/, (ctx) => {
    ctx.aiderTimeoutSeconds = null;
  });

  scoped(/^the launch line carries (--timeout (\d+)|no --timeout flag)$/, (ctx, _whole, digits) => {
    if (digits) {
      assert.equal(
        Number(digits),
        ctx.aiderTimeoutSeconds,
        `Examples timeout column ("${digits}") disagrees with the Given step's own declared value (${ctx.aiderTimeoutSeconds})`
      );
      assert.ok(
        ctx.launchScript.includes(`--timeout ${digits}`),
        `expected --timeout ${digits} in launch script:\n${ctx.launchScript}`
      );
    } else {
      assert.ok(
        !ctx.launchScript.includes('--timeout'),
        `expected no --timeout flag, launch script:\n${ctx.launchScript}`
      );
    }
  });

  // ── Scenario 05 ──────────────────────────────────────────────────────
  scoped(/^the driver's record for the coder names ticket BL-9 and its acceptance feature$/, (ctx) => {
    ctx.__disposables = ctx.__disposables || [];
    ctx.seatTestFixture = makeSeatTestScopeFixture();
    ctx.__disposables.push(() => fs.rmSync(ctx.seatTestFixture.root, { recursive: true, force: true }));
  });

  scoped(/^the seat test verb runs with no ticket in its environment$/, (ctx) => {
    const { root, scriptsDir, logPath } = ctx.seatTestFixture;
    const childEnv = { ...process.env, SWARMFORGE_ROLE: 'coder', PACK_STAFFING_SKIP_GATE: '1' };
    delete childEnv.SEAT_TICKET;
    delete childEnv.SEAT_ACCEPTANCE;
    const result = spawnSync(path.join(scriptsDir, 'seat'), ['test'], { cwd: root, env: childEnv, encoding: 'utf8' });
    ctx.seatTestResult = result;
    ctx.seatTestLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  });

  scoped(/^the pack's seat test command runs with BL-9 and that acceptance feature in its environment$/, (ctx) => {
    assert.equal(
      ctx.seatTestResult.status,
      0,
      `seat test exited ${ctx.seatTestResult.status}: stdout=${ctx.seatTestResult.stdout} stderr=${ctx.seatTestResult.stderr}`
    );
    assert.ok(
      ctx.seatTestLog.includes('SEAT_TICKET=BL-9'),
      `expected SEAT_TICKET=BL-9 in the seat test command's environment, got: ${ctx.seatTestLog}`
    );
    assert.ok(
      ctx.seatTestLog.includes('SEAT_ACCEPTANCE=specs/features/BL-9-thing.feature'),
      `expected SEAT_ACCEPTANCE=specs/features/BL-9-thing.feature, got: ${ctx.seatTestLog}`
    );
  });

  // ── Scenario 06 ──────────────────────────────────────────────────────
  scoped(/^both are byte-identical to what the same pack produced before this ticket$/, (ctx) => {
    assert.equal(
      ctx.launchScript,
      ctx.launchScriptBefore,
      `launch line for role "${ctx.role}" differs from main's pre-ticket output`
    );
    assert.equal(
      ctx.bootstrapStepsText,
      ctx.bootstrapStepsTextBefore,
      `bootstrap steps for role "${ctx.role}" differ from main's pre-ticket output`
    );
  });
}

module.exports = { registerSteps };
