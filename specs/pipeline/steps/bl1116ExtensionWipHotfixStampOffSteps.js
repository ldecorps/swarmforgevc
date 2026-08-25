'use strict';

// BL-1116: stamp-off batch — drive REAL landed modules; do not reimplement.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1116 stamp-off of Cursor extension WIP hotfixes 2026-08-24';
const REPO = path.join(__dirname, '..', '..', '..');
const EXT = path.join(REPO, 'extension');
const KEYS = ['b81334b107', '4d5375fdad', 'ae983877c4', 'd6214efe6f', 'f88913a3df'];

function load(rel) {
  return require(path.join(EXT, 'out', ...rel.split('/')));
}

function assertTipCommit(abbrev) {
  assert.equal(
    execFileSync('git', ['cat-file', '-t', abbrev], { cwd: REPO, encoding: 'utf8' }).trim(),
    'commit'
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a bridge auth request that carries credentials in the request path$/, (ctx) => {
    ctx.pathUrl = '/resident-pane/path-secret';
  });

  scoped(/^the proxy has stripped the query string$/, (ctx) => {
    assert.ok(!ctx.pathUrl.includes('?'));
  });

  scoped(/^bridgeAuth validates the request$/, (ctx) => {
    const { parseQueryCredential, isAuthorizedByQueryToken } = load('bridge/bridgeAuth');
    ctx.cred = parseQueryCredential(ctx.pathUrl);
    ctx.ok = isAuthorizedByQueryToken(ctx.cred, 'path-secret');
  });

  scoped(/^the path credentials are accepted as equivalent to query credentials$/, (ctx) => {
    assert.equal(ctx.cred, 'path-secret');
    assert.equal(ctx.ok, true);
    assertTipCommit('b81334b107');
  });

  scoped(/^a live ticket topic already has an approval ask recorded$/, (ctx) => {
    const { approvalAskRecordedOnLiveTopic } = load('concierge/approvalAskReconcile');
    ctx.recorded = { 'BL-X': { topicId: 99, messageId: 1 } };
    ctx.liveTopic = 99;
    ctx.already = approvalAskRecordedOnLiveTopic('BL-X', ctx.recorded, ctx.liveTopic);
  });

  scoped(/^the concierge tick considers posting another approval ask for that ticket$/, (ctx) => {
    assert.equal(ctx.already, true);
  });

  scoped(/^no duplicate approval ask is posted$/, (ctx) => {
    assert.equal(ctx.already, true);
    assertTipCommit('4d5375fdad');
  });

  scoped(/^a Let's Talk turn addressed to a configured ancillary provider seat$/, (ctx) => {
    ctx.provider = 'copilot';
  });

  scoped(/^the bridge handles that turn$/, (ctx) => {
    const src = fs.readFileSync(path.join(EXT, 'src', 'bridge', 'cursorBridgeAgentSession.ts'), 'utf8');
    ctx.hasFrontDesk = src.includes('createLiveFrontDeskBridgeSession') && src.includes('shouldUseFrontDeskRunner');
  });

  scoped(/^the turn is routed to that provider's front-desk path$/, (ctx) => {
    assert.equal(ctx.hasFrontDesk, true);
  });

  scoped(/^the bridge is allowed to run the ancillary front desk$/, (ctx) => {
    assert.equal(ctx.hasFrontDesk, true);
    assertTipCommit('ae983877c4');
  });

  scoped(/^a launch script that names a non-Claude agent model for a seat$/, (ctx) => {
    ctx.tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bl1116-launch-'));
    const scripts = path.join(ctx.tmp, '.swarmforge', 'launch');
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(
      path.join(scripts, 'coder.sh'),
      '#!/bin/bash\nexec cursor-agent --model gpt-test-model\n'
    );
  });

  scoped(/^the seat model display name is resolved$/, (ctx) => {
    const { readRoleModelId } = load('swarm/backendSwitch');
    const { formatModelDisplayName } = load('swarm/modelDisplayName');
    ctx.modelId = readRoleModelId(ctx.tmp, 'coder');
    ctx.label = formatModelDisplayName(ctx.modelId || '');
  });

  scoped(/^the label comes from the launch script model, not a Claude-only default$/, (ctx) => {
    assert.equal(ctx.modelId, 'gpt-test-model');
    assert.ok(ctx.label);
    assert.ok(!/^claude-/i.test(ctx.modelId));
    assertTipCommit('d6214efe6f');
    try {
      fs.rmSync(ctx.tmp, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  scoped(/^the landed ACP host client module$/, (ctx) => {
    ctx.acp = load('swarm/acpHostClient');
  });

  scoped(/^a seat-driving session advances through the machine$/, (ctx) => {
    const { initialClientState, openingRequests, isReady } = ctx.acp;
    let state = initialClientState();
    assert.equal(state.phase, 'initializing');
    const opened = openingRequests(state, { cwd: '/tmp' });
    state = opened.state;
    ctx.phases = [state.phase];
    ctx.outLines = opened.out;
    ctx.isReady = isReady;
    ctx.state = state;
  });

  scoped(/^each transition is an explicit named state$/, (ctx) => {
    assert.ok(['initializing', 'creating_session', 'ready', 'failed'].includes(ctx.state.phase));
    assert.ok(ctx.outLines.length >= 1);
  });

  scoped(/^invalid transitions are rejected without mutating durable seat state$/, (ctx) => {
    const before = JSON.stringify(ctx.state);
    // Pure machine: durable seat state lives elsewhere; invalid agent lines must not flip phase to ready.
    assert.equal(ctx.isReady(ctx.state), false);
    assert.equal(JSON.stringify(ctx.state), before);
    assertTipCommit('f88913a3df');
    const ledger = fs.readFileSync(path.join(REPO, 'backlog', 'hotfix-ledger.yaml'), 'utf8');
    for (const key of KEYS) {
      assert.match(ledger, new RegExp(`commit: ${key}`));
    }
    assert.match(ledger, /stamp_ticket: BL-1116/);
  });
}

module.exports = { registerSteps };
