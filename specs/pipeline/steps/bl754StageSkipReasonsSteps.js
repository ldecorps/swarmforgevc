'use strict';

// BL-754: malformed stage_skip_reasons is surfaced, never silently truncated.
// Drives the REAL required_stages_lib.bb reader and swarm_handoff.bb send path.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');
const {
  writeAcceptanceContractFixture,
  DEFAULT_FEATURE_PATH: ACCEPTANCE_FEATURE_PATH,
} = require('../../../extension/test/helpers/acceptanceContractFixture');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_HANDOFF = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.bb');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'required_stages_lib.bb');

const FEATURE =
  'a malformed stage_skip_reasons declaration is surfaced, never silently truncated';

const COMMA_REASON = 'no test, obvious';
const ARCHITECT_REASON = 'covered';
const SIMPLE_REASON = 'no test';

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function mkFixture(ctx) {
  if (ctx.root) return ctx.root;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl754-'));
  trackedRoots.push(root);
  git(root, ['init', '-q']);
  writeAcceptanceContractFixture(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  ctx.commit = git(root, ['rev-parse', '--short=10', 'HEAD']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  for (const sub of ['outbox', 'sent', 'failed']) {
    fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', sub), { recursive: true });
  }
  const rows = ['coordinator', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']
    .map((r) => `${r}\t${r === 'coordinator' ? 'master' : r}\t${root}\tswarmforge-${r}\tX\tclaude\ttask`)
    .join('\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${rows}\n`);
  ctx.root = root;
  ctx.ticketId = 'BL-754';
  return root;
}

function quoteReason(style, text) {
  if (style === 'double-quoted') return `"${text}"`;
  if (style === 'single-quoted') return `'${text}'`;
  return text;
}

function flowLine(ctx) {
  const pairs = ctx.flowPairs || [];
  const body = pairs.map(([stage, reason]) => `${stage}: ${reason}`).join(', ');
  return `stage_skip_reasons: { ${body} }`;
}

function ticketYaml(ctx) {
  return [
    `id: ${ctx.ticketId}`,
    'title: "probe"',
    'status: active',
    `acceptance: ${ACCEPTANCE_FEATURE_PATH}`,
    'required_stages: [coder, qa]',
    flowLine(ctx),
    '',
  ].join('\n');
}

function writeTicket(ctx) {
  mkFixture(ctx);
  fs.writeFileSync(path.join(ctx.root, 'backlog', 'active', `${ctx.ticketId}-probe.yaml`), ticketYaml(ctx));
}

function readSkipReasons(ctx) {
  writeTicket(ctx);
  const content = ticketYaml(ctx);
  const expr = [
    "(require '[cheshire.core :as json])",
    `(load-file ${JSON.stringify(LIB)})`,
    '(println (json/generate-string (required-stages-lib/read-stage-skip-reasons (slurp *in*))))',
  ].join('\n');
  const res = spawnSync('bb', ['-e', expr], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    input: content,
  });
  assert.equal(res.status, 0, `read failed: ${res.stderr || res.stdout}`);
  ctx.readResult = JSON.parse(res.stdout.trim());
  return ctx.readResult;
}

function sendHandoff(ctx) {
  writeTicket(ctx);
  const draft = path.join(ctx.root, 'draft.txt');
  fs.writeFileSync(
    draft,
    `type: git_handoff\nto: QA\npriority: 50\ntask: ${ctx.ticketId}\ncommit: ${ctx.commit}\n`
  );
  const res = spawnSync('bb', [SWARM_HANDOFF, 'draft.txt'], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      SWARMFORGE_ROLE: 'coder',
      SWARMFORGE_SKIP_SYNC_INJECT: '1',
      SWARMFORGE_REQUIRED_STAGES_ROUTING: '1',
    },
  });
  ctx.lastSend = {
    status: res.status,
    out: `${res.stdout || ''}${res.stderr || ''}`,
    error: res.error,
  };
  const m = (ctx.lastSend.out || '').match(/:(\/[^\s]*\.handoff)/g);
  if (m && m.length) {
    ctx.envelopePath = m[m.length - 1].slice(1);
    ctx.envelope = fs.readFileSync(ctx.envelopePath, 'utf8');
  }
  const jsonlPath = path.join(ctx.root, '.swarmforge', 'routing-skips.jsonl');
  ctx.jsonlLines = fs.existsSync(jsonlPath)
    ? fs
        .readFileSync(jsonlPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
    : [];
  return ctx.lastSend;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an active ticket carrying a stage_skip_reasons flow mapping$/, (ctx) => {
    mkFixture(ctx);
    ctx.flowPairs = [];
    writeTicket(ctx);
  });

  scoped(/^cleaner is declared with a (.+) reason containing a comma$/, (ctx, quoteStyle) => {
    ctx.flowPairs = [['cleaner', quoteReason(quoteStyle, COMMA_REASON)]];
    ctx.expectedCleanerReason = COMMA_REASON;
  });

  scoped(/^cleaner is declared with an unquoted reason containing a comma$/, (ctx) => {
    ctx.flowPairs = [['cleaner', quoteReason('unquoted', COMMA_REASON)]];
    ctx.expectedCleanerReason = COMMA_REASON;
  });

  scoped(/^cleaner is declared with an unquoted reason containing no comma$/, (ctx) => {
    ctx.flowPairs = [['cleaner', quoteReason('unquoted', SIMPLE_REASON)]];
    ctx.expectedCleanerReason = SIMPLE_REASON;
  });

  scoped(/^the same declaration goes on to declare architect$/, (ctx) => {
    const style =
      ctx.flowPairs && ctx.flowPairs[0] && String(ctx.flowPairs[0][1]).startsWith("'")
        ? 'single-quoted'
        : ctx.flowPairs && ctx.flowPairs[0] && String(ctx.flowPairs[0][1]).startsWith('"')
          ? 'double-quoted'
          : 'unquoted';
    ctx.flowPairs = [...(ctx.flowPairs || []), ['architect', quoteReason(style, ARCHITECT_REASON)]];
    ctx.expectedArchitectReason = ARCHITECT_REASON;
  });

  scoped(/^the stage skip reasons are read$/, (ctx) => {
    readSkipReasons(ctx);
  });

  scoped(/^cleaner's reason is the whole text including the comma$/, (ctx) => {
    assert.equal(ctx.readResult.reasons.cleaner, COMMA_REASON);
  });

  scoped(/^architect's reason is read as declared$/, (ctx) => {
    assert.equal(ctx.readResult.reasons.architect, ARCHITECT_REASON);
  });

  scoped(/^cleaner's reason is read as declared$/, (ctx) => {
    assert.equal(ctx.readResult.reasons.cleaner, ctx.expectedCleanerReason);
  });

  scoped(/^nothing is reported as malformed$/, (ctx) => {
    assert.equal(ctx.readResult.malformed, null);
  });

  scoped(/^the declaration is reported as malformed naming the unparseable remainder$/, (ctx) => {
    assert.ok(ctx.readResult.malformed, 'expected :malformed to be set');
    assert.match(String(ctx.readResult.malformed), /no test, obvious/);
  });

  scoped(/^the routing-skip record carries that report$/, (ctx) => {
    const send = sendHandoff(ctx);
    assert.equal(send.status, 0, `send failed:\n${send.out}`);
    assert.ok(ctx.envelope, 'expected a delivered envelope');
    assert.match(ctx.envelope, /skip_reasons_malformed=/);
    assert.match(ctx.envelope, /no test, obvious/);
    const last = ctx.jsonlLines[ctx.jsonlLines.length - 1];
    assert.ok(last, 'expected a routing-skips.jsonl line');
    const report = last['skip-reasons-malformed'] || last.skip_reasons_malformed;
    assert.ok(report, `expected skip-reasons-malformed on journal: ${JSON.stringify(last)}`);
    assert.match(String(report), /no test, obvious/);
  });

  scoped(/^the coder sends a git_handoff on that ticket$/, (ctx) => {
    sendHandoff(ctx);
  });

  scoped(/^the parcel is delivered to its recipient$/, (ctx) => {
    assert.equal(ctx.lastSend.status, 0, `expected delivery, got:\n${ctx.lastSend.out}`);
    assert.ok(ctx.envelopePath && fs.existsSync(ctx.envelopePath), 'expected installed handoff');
  });

  scoped(/^the send does not abort with an uncaught exception$/, (ctx) => {
    assert.equal(ctx.lastSend.status, 0, `send aborted:\n${ctx.lastSend.out}`);
    assert.doesNotMatch(ctx.lastSend.out, /Exception|NullPointerException|ClassCastException/);
  });
}

module.exports = { registerSteps };
