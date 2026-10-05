'use strict';

// BL-1944 (BL-661 stamp-off): step handlers for "read-stage-skip-reasons
// parses the flow-style mapping every live ticket actually uses". Drives
// the REAL required_stages_lib.bb reader (scenarios 01-04) and the REAL
// swarm_handoff.bb send path (scenario 05), the same fixture shape
// bl754StageSkipReasonsSteps.js already uses for this exact pair of
// scripts - never a restatement of the parser or the routing record.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  writeAcceptanceContractFixture,
  DEFAULT_FEATURE_PATH: ACCEPTANCE_FEATURE_PATH,
} = require('../../../extension/test/helpers/acceptanceContractFixture');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_HANDOFF = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.bb');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'required_stages_lib.bb');

const FEATURE = "read-stage-skip-reasons parses the flow-style mapping every live ticket actually uses";

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
}

function mkFixture(ctx) {
  if (ctx.root) return ctx.root;
  const root = trackedTmpRoot('sfvc-bl661-');
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
  ctx.ticketId = 'BL-96610';
  return root;
}

function ticketYaml(ctx) {
  return [
    `id: ${ctx.ticketId}`,
    'title: "probe"',
    'status: active',
    `acceptance: ${ACCEPTANCE_FEATURE_PATH}`,
    'required_stages: [coder, qa]',
    ctx.skipReasonsText,
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
  const res = spawnSync('bb', ['-e', expr], { cwd: REPO_ROOT, encoding: 'utf8', input: content });
  assert.equal(res.status, 0, `read failed: ${res.stderr || res.stdout}`);
  ctx.readResult = JSON.parse(res.stdout.trim());
  return ctx.readResult;
}

function runHandoffOnce(ctx) {
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
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

// Article 2.3's own two-call protocol: the first invocation for a given
// draft fingerprint prints AUDIT_REQUIRED and queues nothing; an
// IDENTICAL second invocation actually submits. A real send fixture
// drives this exactly like any other sender does, rather than asserting
// on the challenge alone.
function sendHandoff(ctx) {
  writeTicket(ctx);
  const draft = path.join(ctx.root, 'draft.txt');
  fs.writeFileSync(draft, `type: git_handoff\nto: QA\npriority: 50\ntask: ${ctx.ticketId}\ncommit: ${ctx.commit}\n`);
  const challenge = runHandoffOnce(ctx);
  assert.match(challenge.out, /AUDIT_REQUIRED/, `expected the self-audit challenge on first send, got:\n${challenge.out}`);
  ctx.lastSend = runHandoffOnce(ctx);
  const jsonlPath = path.join(ctx.root, '.swarmforge', 'routing-skips.jsonl');
  ctx.jsonlLines = fs.existsSync(jsonlPath)
    ? fs.readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];
  return ctx.lastSend;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^a ticket YAML declares stage_skip_reasons as a flow mapping on the header line$/, (ctx) => {
    ctx.skipReasonsText = 'stage_skip_reasons: { cleaner: "no boundary moves", architect: "test-side only" }';
    ctx.expectedReasons = { cleaner: 'no boundary moves', architect: 'test-side only' };
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^a ticket YAML declares stage_skip_reasons as an indented block mapping$/, (ctx) => {
    ctx.skipReasonsText = 'stage_skip_reasons:\n  cleaner: no boundary moves\n  architect: test-side only';
    ctx.expectedReasons = { cleaner: 'no boundary moves', architect: 'test-side only' };
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(
    /^a ticket YAML declares a flow-style stage_skip_reasons entry whose quoted reason contains a comma and brace characters$/,
    (ctx) => {
      ctx.skipReasonsText = 'stage_skip_reasons: { cleaner: "no test, {skip this} entirely" }';
      ctx.expectedFullReason = 'no test, {skip this} entirely';
    }
  );

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^a flow-style stage_skip_reasons entry uses the "hardener" alias for the "hardender" stage$/, (ctx) => {
    ctx.skipReasonsText = 'stage_skip_reasons: { hardener: "no durable write" }';
  });

  // ── Scenario 05 ──────────────────────────────────────────────────────
  scoped(/^a ticket declares a flow-style stage_skip_reasons entry for a skipped stage$/, (ctx) => {
    ctx.skipReasonsText = 'stage_skip_reasons: { cleaner: "no boundary moves" }';
    ctx.expectedSkipTrailReason = 'no boundary moves';
  });

  // ── shared When/Then ─────────────────────────────────────────────────
  scoped(/^read-stage-skip-reasons parses it$/, (ctx) => {
    readSkipReasons(ctx);
  });

  scoped(/^it returns every declared stage and its reason, not an empty map$/, (ctx) => {
    assert.notDeepEqual(ctx.readResult.reasons, {}, 'expected a non-empty reasons map');
    assert.deepEqual(ctx.readResult.reasons, ctx.expectedReasons);
  });

  scoped(/^it returns every declared stage and its reason, unchanged from before this fix$/, (ctx) => {
    assert.deepEqual(ctx.readResult.reasons, ctx.expectedReasons);
    assert.equal(ctx.readResult.malformed, null);
  });

  scoped(/^the full reason text is returned unaltered, not truncated at the comma or brace$/, (ctx) => {
    assert.equal(ctx.readResult.reasons.cleaner, ctx.expectedFullReason);
    assert.equal(ctx.readResult.malformed, null);
  });

  scoped(/^the reason is keyed under the normalized stage name$/, (ctx) => {
    assert.ok(!('hardener' in ctx.readResult.reasons), 'the alias key must not survive normalization');
    assert.equal(ctx.readResult.reasons.hardender, 'no durable write');
  });

  scoped(/^swarm_handoff\.bb builds the routing decision record for that skip$/, (ctx) => {
    const send = sendHandoff(ctx);
    assert.equal(send.status, 0, `send failed:\n${send.out}`);
  });

  scoped(/^the record's reasons field carries the declared reason text$/, (ctx) => {
    const last = ctx.jsonlLines[ctx.jsonlLines.length - 1];
    assert.ok(last, `expected a routing-skips.jsonl line, got:\n${ctx.lastSend.out}`);
    assert.equal(last.reasons && last.reasons.cleaner, ctx.expectedSkipTrailReason);
  });
}

module.exports = { registerSteps };
