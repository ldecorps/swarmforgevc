'use strict';

// BL-1754: step handlers for "a role asks another role a question through a
// one-shot read-only helper". Drives the REAL peer_question.bb over the REAL
// peer_question_fixture.sh (same fixture test_peer_question_cli.sh uses),
// never a reimplementation of the CLI's own decisions.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'peer_question.bb');
const FIXTURE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'peer_question_fixture.sh');

const FEATURE = 'BL-1754 A role asks another role a question through a one-shot read-only helper';

// Explicit known values per the Scenario Outline handler rule - a mutated
// Examples cell must fail loudly, never silently pass through as a fresh
// provider name the CLI happens to also refuse for an unrelated reason.
const KNOWN_UNSUPPORTED_PROVIDERS = new Set(['aider', 'local-model']);

const FAKE_ANSWER = 'the specifier says yes, it still applies';

function buildFixture(root, opts) {
  const args = [FIXTURE_SH, root];
  const provider = opts && opts.provider;
  if (provider) args.push('--to-provider', `specifier=${provider}`);
  const made = spawnSync('bash', args, { encoding: 'utf8' });
  assert.equal(made.status, 0, `peer_question_fixture.sh failed:\n${made.stderr}`);
}

function overrideSpecifierProvider(root, provider) {
  const tsvPath = path.join(root, '.swarmforge', 'roles.tsv');
  const line = `specifier\tmaster\t${root}\tswarmforge-specifier\tspecifier\t${provider}\ttask\n`;
  fs.writeFileSync(tsvPath, line);
}

function claudeLogText(ctx) {
  return fs.existsSync(ctx.claudeLog) ? fs.readFileSync(ctx.claudeLog, 'utf8') : '';
}

// The argv of the ONE invocation this scenario's own assertions care about -
// everything up to the first ===END=== delimiter. Scenario 02's two Then
// steps both need this, so it is read once and cached on ctx.
function claudeArgs(ctx) {
  if (ctx.claudeArgs) return ctx.claudeArgs;
  const log = claudeLogText(ctx);
  const endAt = log.indexOf('===END===\n');
  const body = endAt === -1 ? log : log.slice(0, endAt);
  ctx.claudeArgs = body.split('\n').filter((_, i, arr) => i < arr.length - 1 || arr[i] !== '');
  return ctx.claudeArgs;
}

function runAsk(ctx, question, timeoutS) {
  const binDir = path.join(ctx.root, 'fake-bin');
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    CLAUDE_FAKE_LOG: ctx.claudeLog,
    CLAUDE_FAKE_PIDFILE: ctx.pidFile,
    CLAUDE_FAKE_PROMPT_COPY: ctx.promptCopy,
    CLAUDE_FAKE_ANSWER: FAKE_ANSWER,
    TMUX_FAKE_LOG: ctx.tmuxLog,
  };
  if (ctx.fakeSleepS) env.CLAUDE_FAKE_SLEEP_S = String(ctx.fakeSleepS);

  const args = [CLI, ctx.root, '--from', 'QA', '--to', 'specifier', '--question', question];
  if (timeoutS) args.push('--timeout-s', String(timeoutS));

  const run = spawnSync('bb', args, { encoding: 'utf8', env, cwd: REPO_ROOT });
  ctx.lastQuestion = question;
  ctx.exitCode = run.status;
  ctx.stdout = run.stdout || '';
  ctx.stderr = run.stderr || '';
  ctx.output = `${ctx.stdout}${ctx.stderr}`;
}

function registerSteps(registry) {
  const define = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  define(/^a fixture project whose specifier seat runs claude through a recording fake$/, (ctx) => {
    const root = trackedTmpRoot('bl1754-');
    buildFixture(root);
    ctx.root = root;
    ctx.claudeLog = path.join(root, 'claude-calls.log');
    ctx.pidFile = path.join(root, 'claude.pid');
    ctx.promptCopy = path.join(root, 'prompt-copy.md');
    ctx.tmuxLog = path.join(root, 'tmux-calls.log');
    fs.writeFileSync(ctx.claudeLog, '');
  });

  // ── Given ─────────────────────────────────────────────────────────────
  define(/^specifier's seat runs (aider|local-model)$/, (ctx, provider) => {
    assert.ok(
      KNOWN_UNSUPPORTED_PROVIDERS.has(provider),
      `unknown provider "${provider}" - known: ${[...KNOWN_UNSUPPORTED_PROVIDERS].join(', ')}`
    );
    overrideSpecifierProvider(ctx.root, provider);
    ctx.provider = provider;
  });

  define(/^the fake never answers$/, (ctx) => {
    ctx.fakeSleepS = 30;
  });

  define(/^specifier's mailbox holds a git_handoff parcel$/, (ctx) => {
    ctx.parcelPath = path.join(ctx.root, '.swarmforge', 'handoffs', 'specifier', 'inbox', 'new', 'fixture.handoff');
    assert.ok(fs.existsSync(ctx.parcelPath), 'the fixture must already seed a parcel');
    ctx.parcelBefore = fs.readFileSync(ctx.parcelPath, 'utf8');
  });

  define(/^the backlog root holds a raw intake$/, (ctx) => {
    ctx.intakePath = path.join(ctx.root, 'backlog', 'INTAKE-fixture.md');
    assert.ok(fs.existsSync(ctx.intakePath), 'the fixture must already seed a raw intake');
    ctx.intakeBefore = fs.readFileSync(ctx.intakePath, 'utf8');
  });

  // ── When ──────────────────────────────────────────────────────────────
  define(/^QA asks specifier "([^"]+)"$/, (ctx, question) => {
    runAsk(ctx, question, null);
  });

  define(/^QA asks specifier "([^"]+)" with a (\d+) second bound$/, (ctx, question, seconds) => {
    runAsk(ctx, question, Number(seconds));
  });

  // ── Then: scenario 01 ─────────────────────────────────────────────────
  define(/^the fake's answer is printed$/, (ctx) => {
    assert.equal(ctx.exitCode, 0, `expected a clean exit, got ${ctx.exitCode}: ${ctx.output}`);
    assert.equal(ctx.stdout.trim(), FAKE_ANSWER, `expected the fake's own answer on stdout, got: ${ctx.stdout}`);
  });

  define(/^a question record names QA, specifier, the question and the answer$/, (ctx) => {
    const dir = path.join(ctx.root, '.swarmforge', 'peer-questions');
    assert.ok(fs.existsSync(dir), 'expected a .swarmforge/peer-questions/ directory');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1, `expected exactly one question record, got: ${files.join(', ')}`);
    const record = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    assert.equal(record.from, 'QA');
    assert.equal(record.to, 'specifier');
    assert.equal(record.question, ctx.lastQuestion);
    assert.equal(record.answer, FAKE_ANSWER);
  });

  // ── Then: scenario 02 ─────────────────────────────────────────────────
  define(/^claude was called exactly once, in print mode$/, (ctx) => {
    const log = claudeLogText(ctx);
    const endCount = (log.match(/^===END===$/gm) || []).length;
    assert.equal(endCount, 1, `expected exactly one claude invocation, got ${endCount}. Log:\n${log}`);
    assert.ok(claudeArgs(ctx).includes('-p'), `expected -p (print mode) among the arguments: ${claudeArgs(ctx).join(' ')}`);
  });

  define(/^that call allows file-reading tools only$/, (ctx) => {
    const args = claudeArgs(ctx);
    const toolsIdx = args.indexOf('--tools');
    assert.notEqual(toolsIdx, -1, `expected --tools among the arguments: ${args.join(' ')}`);
    assert.equal(args[toolsIdx + 1], 'Read,Glob,Grep', `expected the tool set to be exactly Read,Glob,Grep`);
    assert.ok(args.includes('--restricted'), `expected --restricted among the arguments: ${args.join(' ')}`);
    assert.ok(
      !args.includes('--dangerously-skip-permissions'),
      'expected no --dangerously-skip-permissions - the tool restriction is structural, not a skipped prompt'
    );
    assert.ok(
      !args.includes('--allowedTools'),
      'expected no --allowedTools - a permission allowlist is not the hard --tools restriction'
    );
  });

  define(/^that call carries the specifier's role prompt$/, (ctx) => {
    const args = claudeArgs(ctx);
    assert.ok(
      args.includes('--append-system-prompt-file'),
      `expected --append-system-prompt-file among the arguments: ${args.join(' ')}`
    );
    assert.ok(fs.existsSync(ctx.promptCopy), 'expected the fake to have copied the composed prompt file');
    const prompt = fs.readFileSync(ctx.promptCopy, 'utf8');
    assert.ok(prompt.includes('You are the specifier.'), `expected the specifier's own role prompt inlined, got:\n${prompt.slice(0, 200)}`);
  });

  // ── Then: scenario 03 ─────────────────────────────────────────────────
  define(/^specifier's parcel is still in its inbox$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.parcelPath), 'expected the parcel file to still exist');
    assert.equal(fs.readFileSync(ctx.parcelPath, 'utf8'), ctx.parcelBefore, 'the parcel content changed');
  });

  define(/^the raw intake is still in the backlog root$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.intakePath), 'expected the raw intake to still exist');
    assert.equal(fs.readFileSync(ctx.intakePath, 'utf8'), ctx.intakeBefore, 'the raw intake content changed');
  });

  define(/^no tmux session is created$/, (ctx) => {
    const log = fs.existsSync(ctx.tmuxLog) ? fs.readFileSync(ctx.tmuxLog, 'utf8') : '';
    assert.equal(log.trim(), '', `expected tmux to never be invoked, got:\n${log}`);
  });

  define(/^no process the helper started is alive$/, (ctx) => {
    if (!fs.existsSync(ctx.pidFile)) return; // claude was never started (e.g. a refusal) - trivially true
    const pid = Number(fs.readFileSync(ctx.pidFile, 'utf8').trim());
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.ok(!alive, `expected pid ${pid} (the helper's own claude child) to be dead`);
  });

  // ── Then: scenario 04 ─────────────────────────────────────────────────
  define(/^the ask exits non-zero naming (aider|local-model)$/, (ctx, provider) => {
    assert.ok(
      KNOWN_UNSUPPORTED_PROVIDERS.has(provider),
      `unknown provider "${provider}" - known: ${[...KNOWN_UNSUPPORTED_PROVIDERS].join(', ')}`
    );
    assert.notEqual(ctx.exitCode, 0, `expected a nonzero exit, got 0: ${ctx.output}`);
    assert.ok(ctx.output.includes(provider), `expected the refusal to name "${provider}", got: ${ctx.output}`);
  });

  define(/^claude was not called$/, (ctx) => {
    assert.equal(claudeLogText(ctx).trim(), '', `expected claude to never be invoked, got:\n${claudeLogText(ctx)}`);
  });

  // ── Then: scenario 05 ─────────────────────────────────────────────────
  define(/^the ask exits non-zero saying it timed out$/, (ctx) => {
    assert.notEqual(ctx.exitCode, 0, `expected a nonzero exit, got 0: ${ctx.output}`);
    assert.match(ctx.output, /timed out|timeout/i, ctx.output);
  });
}

module.exports = { registerSteps };
