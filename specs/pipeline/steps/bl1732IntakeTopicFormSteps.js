'use strict';

// BL-1732: step handlers for "The Intake topic opens a form that files an
// intake in the shared vocabulary". Drives the real bridge routes
// (GET /intake-form-state, POST /intake-form/submit) via a real
// startBridge instance, the real vocabulary store and intake writer
// on-disk, and the real (pure) topic decision functions - never a
// reimplementation of any of the three. The Telegram client and the
// phone are the unsuitable boundary (engineering Design And Testability);
// this handler drives the bridge routes, the stores and the topic
// decision in-process, per the ticket's own constraint.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { copyLiveScriptClosureInto } = require('../../../extension/test/helpers/pinnedRepoFixture');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

let _lib = null;
function lib() {
  if (!_lib) {
    _lib = {
      ...require('../../../extension/out/bridge/bridgeServer'),
      ...require('../../../extension/out/bridge/cursorBridgeAgentSession'),
      ...require('../../../extension/out/bridge/intakeVocabularyStore'),
      ...require('../../../extension/out/tools/telegramTopicDecisions'),
    };
  }
  return _lib;
}

const FEATURE = 'BL-1732 The Intake topic opens a form that files an intake in the shared vocabulary';
const TOKEN = 'intake-form-token';
const NOW = 1_700_000_000_000;

function mkFixture() {
  const root = trackedTmpRoot('sfvc-bl1732-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  copyLiveScriptClosureInto(path.join(root, 'swarmforge', 'scripts'), ['commit_integrity_cli.bb']);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

async function withBridge(ctx, fn) {
  const handle = await lib().startBridge(ctx.root, path.join(ctx.root, 'runs.jsonl'), TOKEN, {
    nowMs: NOW,
    letsTalk: { agentSession: lib().createMockCursorBridgeAgentSession(ctx.root) },
  });
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

function controlHeaders() {
  return {
    authorization: `Bearer ${TOKEN}`,
    'x-control-token': TOKEN,
    'content-type': 'application/json',
  };
}

async function fetchState(ctx) {
  return withBridge(ctx, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/intake-form-state?token=${TOKEN}`);
    assert.equal(res.status, 200);
    return res.json();
  });
}

async function submitDraft(ctx, draft, { auth = true } = {}) {
  return withBridge(ctx, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/intake-form/submit`, {
      method: 'POST',
      headers: auth ? controlHeaders() : { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const body = await res.json();
    return { status: res.status, body };
  });
}

function listIntakeFiles(root) {
  return fs.readdirSync(path.join(root, 'backlog')).filter((name) => name.startsWith('INTAKE-'));
}

function baseDraft(overrides = {}) {
  return {
    actor: 'the human',
    action: 'file a new intake from my phone',
    goal: 'keep the backlog in one ubiquitous language',
    scenarios: 'Given some state\nWhen something happens\nThen some other state',
    ...overrides,
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the shared vocabulary holds the starter list$/, (ctx) => {
    ctx.root = mkFixture();
    lib().seedVocabularyIfMissing(ctx.root);
  });

  // ── Scenario 01 (Outline) ─────────────────────────────────────────────
  scoped(/^I open a new draft from the Intake topic$/, async (ctx) => {
    ctx.state = await fetchState(ctx);
  });

  scoped(/^the (\S+) dropdown offers "([^"]+)"$/, (ctx, slot, value) => {
    assert.ok(
      ctx.state.vocabulary[slot].includes(value),
      `expected ${slot} to offer "${value}", got: ${JSON.stringify(ctx.state.vocabulary[slot])}`
    );
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^I add the actor "([^"]+)" to my draft$/, async (ctx, value) => {
    const state = await fetchState(ctx);
    ctx.draftVocabulary = lib().withValue(state.vocabulary, 'actor', value);
    ctx.addedActor = value;
  });

  scoped(/^my draft's actor dropdown offers "([^"]+)"$/, (ctx, value) => {
    assert.ok(ctx.draftVocabulary.actor.includes(value));
  });

  scoped(/^the shared vocabulary does not hold "([^"]+)"$/, async (ctx, value) => {
    const state = await fetchState(ctx);
    assert.ok(!state.vocabulary.actor.includes(value), `expected the shared vocabulary to NOT hold "${value}" yet`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^my draft uses the new goal "([^"]+)"$/, (ctx, value) => {
    ctx.draft = baseDraft({ goal: value, newValues: { goal: value } });
  });

  scoped(/^I submit the draft$/, async (ctx) => {
    ctx.submitResult = await submitDraft(ctx, ctx.draft);
    assert.equal(ctx.submitResult.status, 200, `expected submit to succeed, got: ${JSON.stringify(ctx.submitResult.body)}`);
  });

  scoped(/^a new draft's goal dropdown offers "([^"]+)"$/, async (ctx, value) => {
    const state = await fetchState(ctx);
    assert.ok(state.vocabulary.goal.includes(value));
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^a draft with a narrative and one scenario$/, (ctx) => {
    ctx.draft = baseDraft();
  });

  scoped(/^an INTAKE file holding the narrative and the scenario is at the backlog root$/, (ctx) => {
    const files = listIntakeFiles(ctx.root);
    assert.equal(files.length, 1, `expected exactly one INTAKE file, got: ${JSON.stringify(files)}`);
    const text = fs.readFileSync(path.join(ctx.root, 'backlog', files[0]), 'utf8');
    assert.match(text, /As the human, I want to file a new intake from my phone, so I can keep the backlog in one ubiquitous language\./);
    assert.match(text, /Given some state/);
    ctx.intakeText = text;
  });

  scoped(/^the Intake topic confirms it with the file's permalink$/, (ctx) => {
    assert.ok(ctx.submitResult.body.success, 'expected the submit response to report success');
    assert.match(ctx.submitResult.body.confirmationText, /^Filed for the swarm: /);
  });

  // ── Scenario 05 ──────────────────────────────────────────────────────
  scoped(/^the tunnel serving the form is down$/, (ctx) => {
    ctx.formUrl = undefined;
  });

  scoped(/^I ask the Intake topic for the form$/, (ctx) => {
    ctx.topicReply = lib().decideIntakeTopicReply(ctx.formUrl);
  });

  scoped(/^the topic replies that the form is unreachable and why$/, (ctx) => {
    assert.equal(ctx.topicReply.kind, 'unreachable');
    assert.match(ctx.topicReply.text, /unreachable/);
    assert.match(ctx.topicReply.text, /tunnel/);
  });

  // ── Scenario 06 ──────────────────────────────────────────────────────
  scoped(/^the draft is submitted without the bridge's device token$/, async (ctx) => {
    ctx.submitResult = await submitDraft(ctx, ctx.draft, { auth: false });
  });

  scoped(/^the submit is refused$/, (ctx) => {
    assert.equal(ctx.submitResult.status, 401, `expected 401, got ${ctx.submitResult.status}: ${JSON.stringify(ctx.submitResult.body)}`);
  });

  scoped(/^no INTAKE file is written$/, (ctx) => {
    assert.deepEqual(listIntakeFiles(ctx.root), []);
  });

  // ── Scenario 07 ──────────────────────────────────────────────────────
  scoped(/^the draft's rule field holds "([^"]+)"$/, (ctx, rule) => {
    ctx.draft = { ...ctx.draft, rule };
  });

  scoped(/^the INTAKE file holds the rule "([^"]+)"$/, (ctx, rule) => {
    const files = listIntakeFiles(ctx.root);
    const text = fs.readFileSync(path.join(ctx.root, 'backlog', files[0]), 'utf8');
    assert.match(text, new RegExp(`## Rule\\n\\n${rule.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`));
  });

  // ── Scenario 08 ──────────────────────────────────────────────────────
  scoped(/^the draft's rule field is blank$/, (ctx) => {
    ctx.draft = { ...ctx.draft, rule: '   ' };
  });

  scoped(/^the INTAKE file holds no rule section$/, (ctx) => {
    const files = listIntakeFiles(ctx.root);
    const text = fs.readFileSync(path.join(ctx.root, 'backlog', files[0]), 'utf8');
    assert.ok(!text.includes('## Rule'));
  });
}

module.exports = { registerSteps };
