'use strict';

// BL-1839: step handlers for "BL-1839 Swarm stamp-off of the coder@iq3
// hotfixes" - a review-only certification of what the specifier landed on
// 2026-09-30 (2cdb259806, 7f38e5d7fe, 91c208a923) at the human's direction.
// Every scenario drives the REAL shipped code - swarmforge.sh (sourced; its
// ZSH_EVAL_CONTEXT toplevel guard means sourcing it never launches
// anything, the same guard BL-1801's and BL-1838's own handlers rely on),
// start-swarm.sh (sourced under its BL1839_TEST_SOURCE_ONLY=1 seam, which
// returns right after the loopback-key resolution this scenario checks,
// before anything with a side effect), ollama_ancillary_lib.sh, and
// prompt_engine_cli.bb - never a reimplementation of any of their logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1839 Swarm stamp-off of the coder@iq3 hotfixes';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const START_SWARM_SH = path.join(REPO_ROOT, 'start-swarm.sh');
const SEAT_DIFFICULTY_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'seat_difficulty_lib.bb');
const PROMPT_ENGINE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'prompt_engine_cli.bb');

const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function ensure(ctx) {
  if (!ctx.bl1839) {
    ctx.bl1839 = {};
  }
  return ctx.bl1839;
}

function mkFixtureRoot() {
  const root = trackedTmpRoot('bl1839-root-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), 'x'.repeat(40000));
  for (const role of ['coder', 'specifier', 'documenter']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

function writeConf(root, windowLine) {
  // BL-982: a stage declaring an @-seat must also declare its bare seat.
  const stage = windowLine.split(/\s+/)[1].split('@')[0];
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    `config active_backlog_max_depth -1\nwindow ${stage} claude ${stage}\n${windowLine}\n`
  );
}

function sourceAndRun(root, windowLine, body) {
  const script = `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${INDEX_OF_ROLE} ${body}`;
  return spawnSync('zsh', ['-f', '-c', script], {
    encoding: 'utf8',
    env: { ...process.env, PACK_STAFFING_SKIP_GATE: '1' },
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── 01: the window gate measures the stage card, not the constitution ──

  scoped(/^a pack whose window line is "([^"]+)"$/, (ctx, windowLine) => {
    ensure(ctx).windowLine = windowLine;
  });

  scoped(/^the swarm checks the seat's window at launch$/, (ctx) => {
    const st = ensure(ctx);
    const root = mkFixtureRoot();
    writeConf(root, st.windowLine);
    // BL-982: the window line's ROLE field is the seat id (e.g.
    // "coder@iq3"); parse_config derives seat_stage from the part before
    // "@" and stores it in STAGES[i] - the same array
    // check_local_model_seat_windows (swarmforge.sh:820) passes to
    // `prompt_engine_cli.bb compose local-model`. Reading STAGES[i] back
    // through the real parser pins which stage the real gate call
    // composes, without reimplementing parse_config's own parsing.
    const seatId = st.windowLine.split(/\s+/)[1];
    const r = sourceAndRun(root, st.windowLine, `echo "\${STAGES[$(index_of_role "${seatId}")]}"`);
    assert.equal(r.status, 0, `expected parse_config to accept the window line, got: ${r.stdout}${r.stderr}`);
    st.stage = r.stdout.trim();
  });

  scoped(/^the prompt the gate measures is the composed local-model coder card$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.stage, 'coder', `expected the gate to key composition on stage "coder", got "${st.stage}"`);
    const compose = spawnSync('bb', [PROMPT_ENGINE_CLI, 'compose', 'local-model', st.stage, '0', ''], { encoding: 'utf8' });
    assert.equal(compose.status, 0, `expected compose to succeed, got: ${compose.stdout}${compose.stderr}`);
    st.composedPrompt = compose.stdout;
    // The full constitution (what a seat id with no known stage would
    // compose instead, per swarmforge.sh:802-806's own comment) is far
    // larger than any compact card - a regression that started composing
    // the seat id again would blow straight through the character bound
    // the next assertion checks.
    assert.ok(st.composedPrompt.length < 10000, `expected a compact card, not the full constitution: ${st.composedPrompt.length} chars`);
  });

  scoped(/^that prompt is at most (\d+) characters$/, (ctx, max) => {
    const st = ensure(ctx);
    assert.ok(
      st.composedPrompt.length <= Number(max),
      `expected the composed card to be at most ${max} chars, got ${st.composedPrompt.length}`
    );
  });

  // ── 02: the qwen launch drops --seat-tier; the claim tier still reads ──

  scoped(/^the swarm writes the seat's launch script$/, (ctx) => {
    const st = ensure(ctx);
    const root = mkFixtureRoot();
    writeConf(root, st.windowLine);
    const seatId = st.windowLine.split(/\s+/)[1];
    const r = sourceAndRun(root, st.windowLine, `write_role_launch_script "$(index_of_role "${seatId}")"`);
    assert.equal(r.status, 0, `expected write_role_launch_script to succeed, got: ${r.stdout}${r.stderr}`);
    const launchPath = path.join(root, '.swarmforge', 'launch', `${seatId}.sh`);
    assert.ok(fs.existsSync(launchPath), `expected a launch script at ${launchPath}`);
    st.launchScript = fs.readFileSync(launchPath, 'utf8');
    st.confPath = path.join(root, 'swarmforge', 'swarmforge.conf');
  });

  scoped(/^the qwen command in it carries no "([^"]+)"$/, (ctx, flag) => {
    const st = ensure(ctx);
    assert.ok(!st.launchScript.includes(flag), `expected the launch script to carry no ${flag}, got:\n${st.launchScript}`);
  });

  scoped(/^the seat's claim tier still reads "([^"]+)"$/, (ctx, tier) => {
    const st = ensure(ctx);
    // seat_difficulty_lib.bb's parse-seat-tiers reads the PACK CONF window
    // line directly (never the generated launch script), so the strip
    // inside write_role_launch_script cannot have touched it - this is
    // exactly the independence the ticket's probe asks to confirm.
    const r = spawnSync('bb', [
      '-e',
      `(load-file "${SEAT_DIFFICULTY_LIB}") (println (get (seat-difficulty-lib/parse-seat-tiers (slurp "${st.confPath}")) "coder@iq3"))`,
    ], { encoding: 'utf8' });
    assert.equal(r.status, 0, `expected parse-seat-tiers to run, got: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout.trim(), tier, `expected claim tier "${tier}", got "${r.stdout.trim()}"`);
  });

  // ── 03: start-swarm picks the Ollama key only for a loopback base ───────

  scoped(/^a throwaway HOME whose \.zshenv exports OPENAI_API_KEY "([^"]+)"$/, (ctx, key) => {
    const st = ensure(ctx);
    const home = trackedTmpRoot('bl1839-home-');
    fs.writeFileSync(path.join(home, '.zshenv'), `export OPENAI_API_KEY=${key}\n`);
    st.fakeHome = home;
  });

  scoped(/^OPENAI_API_BASE is "([^"]+)"$/, (ctx, base) => {
    ensure(ctx).openaiApiBase = base;
  });

  scoped(/^start-swarm\.sh prepares the launch environment$/, (ctx) => {
    const st = ensure(ctx);
    const target = trackedTmpRoot('bl1839-target-');
    const r = spawnSync('bash', ['-c', `source '${START_SWARM_SH}' '${target}'; printf '%s' "$OPENAI_API_KEY"`], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: st.fakeHome,
        OPENAI_API_BASE: st.openaiApiBase,
        BL1839_TEST_SOURCE_ONLY: '1',
      },
    });
    assert.equal(r.status, 0, `expected start-swarm.sh to source cleanly, got: ${r.stdout}${r.stderr}`);
    st.resultingKey = r.stdout;
  });

  scoped(/^OPENAI_API_KEY in it is "([^"]+)"$/, (ctx, key) => {
    const st = ensure(ctx);
    assert.equal(st.resultingKey, key, `expected OPENAI_API_KEY "${key}", got "${st.resultingKey}"`);
  });

  // ── 04: the Ollama start quantises the KV cache unless the caller chose ─

  scoped(/^the caller sets OLLAMA_KV_CACHE_TYPE to "([^"]+)"$/, (ctx, caller) => {
    ensure(ctx).callerKvCacheType = caller === '(unset)' ? undefined : caller;
  });

  scoped(/^the swarm starts its Ollama server$/, (ctx) => {
    const st = ensure(ctx);
    const binDir = trackedTmpRoot('bl1839-bin-');
    const envFile = path.join(binDir, 'env.out');
    const ollamaStub = path.join(binDir, 'ollama');
    fs.writeFileSync(
      ollamaStub,
      '#!/usr/bin/env bash\n' +
        `printf 'OLLAMA_FLASH_ATTENTION=%s\\n' "$OLLAMA_FLASH_ATTENTION" > '${envFile}'\n` +
        `printf 'OLLAMA_KV_CACHE_TYPE=%s\\n' "$OLLAMA_KV_CACHE_TYPE" >> '${envFile}'\n` +
        'exit 0\n'
    );
    fs.chmodSync(ollamaStub, 0o755);
    const logPath = path.join(binDir, 'serve.log');
    const env = { ...process.env };
    if (st.callerKvCacheType === undefined) {
      delete env.OLLAMA_KV_CACHE_TYPE;
    } else {
      env.OLLAMA_KV_CACHE_TYPE = st.callerKvCacheType;
    }
    delete env.OLLAMA_FLASH_ATTENTION;
    const r = spawnSync(
      'bash',
      ['-c', `source '${path.join(REPO_ROOT, 'swarmforge', 'scripts', 'ollama_ancillary_lib.sh')}'; ollama_ancillary_start_server '${ollamaStub}' '' '' '${logPath}'`],
      { encoding: 'utf8', env }
    );
    assert.equal(r.status, 0, `expected ollama_ancillary_start_server to succeed, got: ${r.stdout}${r.stderr}`);
    // The server is started with nohup ... & inside the function; give the
    // stub a moment to actually run and write its env dump.
    const deadline = Date.now() + 2000;
    while (!fs.existsSync(envFile) && Date.now() < deadline) {
      spawnSync('sleep', ['0.05']);
    }
    st.startedEnv = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  });

  scoped(/^the server starts with OLLAMA_FLASH_ATTENTION "([^"]+)" and OLLAMA_KV_CACHE_TYPE "([^"]+)"$/, (ctx, flashAttn, kvCache) => {
    const st = ensure(ctx);
    assert.match(st.startedEnv, new RegExp(`OLLAMA_FLASH_ATTENTION=${flashAttn}(\\n|$)`), `expected flash attention ${flashAttn}, got:\n${st.startedEnv}`);
    assert.match(st.startedEnv, new RegExp(`OLLAMA_KV_CACHE_TYPE=${kvCache}(\\n|$)`), `expected KV cache type ${kvCache}, got:\n${st.startedEnv}`);
  });

  // ── 05: the local-model card keeps the seat on its ticket ──────────────

  scoped(/^the prompt factory composes the "([^"]+)" prompt for the "([^"]+)" agent$/, (ctx, stage, agent) => {
    const st = ensure(ctx);
    const r = spawnSync('bb', [PROMPT_ENGINE_CLI, 'compose', agent, stage, '0', ''], { encoding: 'utf8' });
    assert.equal(r.status, 0, `expected compose to succeed, got: ${r.stdout}${r.stderr}`);
    st.composedCard = r.stdout;
  });

  scoped(/^it tells the seat not to read the constitution, PIPELINE or its full role prompt when it starts$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.composedCard, /Do NOT read/, `expected a "Do NOT read" instruction, got:\n${st.composedCard}`);
    assert.match(st.composedCard, /constitution\.prompt/, `expected the constitution to be named, got:\n${st.composedCard}`);
    assert.match(st.composedCard, /PIPELINE\.md/, `expected PIPELINE.md to be named, got:\n${st.composedCard}`);
  });

  scoped(/^it tells the seat to read a large file in parts and to change an existing file with the edit tool$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.composedCard, /in parts/, `expected a "read in parts" instruction, got:\n${st.composedCard}`);
    assert.match(st.composedCard, /edit tool/, `expected an "edit tool" instruction, got:\n${st.composedCard}`);
  });

  scoped(/^it still names swarmforge\/roles\/coder\.prompt and swarmforge\/constitution\.prompt$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.composedCard, /swarmforge\/roles\/coder\.prompt/, `expected coder.prompt to be named, got:\n${st.composedCard}`);
    assert.match(st.composedCard, /swarmforge\/constitution\.prompt/, `expected constitution.prompt to be named, got:\n${st.composedCard}`);
  });
}

module.exports = { registerSteps };
