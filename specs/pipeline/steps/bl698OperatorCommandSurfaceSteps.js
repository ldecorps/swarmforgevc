'use strict';

// BL-2025 (BL-698 stamp-off): step handlers for the nine scenarios BL-2023's
// adjudication left in BL-698's feature after retiring 17 duplicated/
// contradicted/unwireable/meta scenarios. Drives the REAL compiled modules
// in-process - telegramCursorBridgeLive.js's handleInboundDecision for the
// three scenarios that depend on swarm/full-pack liveness (BL-703's own
// isSwarmLive over tmux `has-session`, faked via a PATH stub that always
// succeeds - never a real tmux server), telegramCursorOperatorExec.js's
// executeOperatorVerb for the confirm-tier verb executors (bl702's own
// template), and telegramControlCore.js / telegramOperatorAmbulance.js for
// the Control-topic/Cursor-Remote shared-backend scenario. Never a
// restatement of the decision or execution logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
let _bridgeCore = null;
function bridgeCore() {
  if (!_bridgeCore) _bridgeCore = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgeCore'));
  return _bridgeCore;
}
let _bridgeLive = null;
function bridgeLive() {
  if (!_bridgeLive) _bridgeLive = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorBridgeLive'));
  return _bridgeLive;
}
let _operatorCore = null;
function operatorCore() {
  if (!_operatorCore) _operatorCore = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorOperatorCore'));
  return _operatorCore;
}
let _operatorExec = null;
function operatorExec() {
  if (!_operatorExec) _operatorExec = require(path.join(EXT_DIR, 'out', 'tools', 'telegramCursorOperatorExec'));
  return _operatorExec;
}
let _controlCore = null;
function controlCore() {
  if (!_controlCore) _controlCore = require(path.join(EXT_DIR, 'out', 'tools', 'telegramControlCore'));
  return _controlCore;
}
let _ambulanceLib = null;
function ambulanceLib() {
  if (!_ambulanceLib) _ambulanceLib = require(path.join(EXT_DIR, 'out', 'tools', 'telegramOperatorAmbulance'));
  return _ambulanceLib;
}

const FEATURE = 'BL-698 Telegram / Cursor Remote operator command surface';

const PRINCIPAL_ID = 'principal-1';
const CHAT_ID = 'chat-1';
const CURSOR_TOPIC_ID = 42;
const CONTROL_TOPIC_ID = 50;

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeSwarmEnv(root) {
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'swarm.env'), 'export BL698_BASELINE="present"\n');
}

function mkFixtureRoot(ctx) {
  if (ctx.root) return ctx.root;
  const root = trackedTmpRoot('sfvc-bl698-');
  writeSwarmEnv(root);
  ctx.root = root;
  return root;
}

// readLiveSwarmRoles() -> sessionExists() shells out to `tmux -S <socket>
// has-session -t <session>`; this fake always succeeds, so a session row
// in sessions.tsv reads as live without ever starting a real tmux server
// (never 'new-session'/'start-server' - nothing here can create one).
function writeFakeTmuxOnPath(root) {
  const bin = path.join(root, 'bin');
  mkdirp(bin);
  const tmuxBin = path.join(bin, 'tmux');
  fs.writeFileSync(tmuxBin, '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(tmuxBin, 0o755);
  return bin;
}

function writeLiveSessionFixture(root, role) {
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), 'fake-socket\n');
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'sessions.tsv'),
    `1\t${role}\tswarmforge-${role}\t${role}\tclaude\n`
  );
}

async function withFakeTmuxOnPath(root, fn) {
  const bin = writeFakeTmuxOnPath(root);
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}:${prevPath}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = prevPath;
  }
}

function inboundEvent(text, topicId = CURSOR_TOPIC_ID) {
  return { kind: 'text', fromId: PRINCIPAL_ID, chatId: CHAT_ID, topicId, text };
}

function callbackEvent(data, topicId = CURSOR_TOPIC_ID) {
  return { kind: 'callback', fromId: PRINCIPAL_ID, chatId: CHAT_ID, topicId, text: '', callbackData: data };
}

// A throwing promptAgent proves "no Cursor expedition starts"/"without
// starting a Cursor expedition" structurally: any code path that reaches
// the agent in these refuse/mode-select scenarios fails the step loudly
// instead of silently passing.
function liveCtx(ctx) {
  mkFixtureRoot(ctx);
  if (ctx.live) return ctx.live;
  ctx.posts = ctx.posts || [];
  ctx.live = {
    repoRoot: ctx.root,
    botToken: 't',
    chatId: CHAT_ID,
    state: { updateOffset: 0, cursorTopicId: CURSOR_TOPIC_ID },
    busy: false,
    agentSession: {
      promptAgent: async () => {
        throw new Error('must not start a Cursor expedition for this scenario');
      },
      resetSession: async () => ({ agentId: 'should-not-be-used' }),
      readAgentId: () => 'should-not-be-used',
    },
    opDir: path.join(ctx.root, '.swarmforge', 'operator'),
    post: async (_t, _c, _topic, text) => {
      ctx.posts.push(text);
    },
    persistState: () => {},
    syncAgentIdFromSession: () => {},
  };
  return ctx.live;
}

function writeTicketYaml(root, folder, id, fields = {}) {
  const dir = path.join(root, 'backlog', folder);
  mkdirp(dir);
  const lines = [`id: ${id}`, `title: ${fields.title || `${id} fixture ticket`}`];
  if (fields.type) lines.push(`type: ${fields.type}`);
  if (fields.severity) lines.push(`severity: ${fields.severity}`);
  if (fields.priority !== undefined) lines.push(`priority: ${fields.priority}`);
  if (fields.humanApproval) lines.push(`human_approval: ${fields.humanApproval}`);
  if (fields.acceptance) lines.push(`acceptance: ${fields.acceptance}`);
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `${lines.join('\n')}\n`);
}

function ticketPath(root, folder, id) {
  return path.join(root, 'backlog', folder, `${id}.yaml`);
}

function ensureActiveTicket(root, id) {
  if (
    !fs.existsSync(ticketPath(root, 'active', id)) &&
    !fs.existsSync(ticketPath(root, 'paused', id)) &&
    !fs.existsSync(ticketPath(root, 'hold', id))
  ) {
    writeTicketYaml(root, 'active', id);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ─────────────────────────────────────────────────────────
  scoped(/^a principal-only Cursor Remote Telegram topic$/, (ctx) => {
    mkFixtureRoot(ctx);
  });

  scoped(/^\.swarmforge\/swarm\.env exists with operator keys$/, (ctx) => {
    mkFixtureRoot(ctx);
    assert.ok(fs.existsSync(path.join(ctx.root, '.swarmforge', 'swarm.env')));
  });

  scoped(/^unauthorised senders and wrong topics never mutate swarm state$/, () => {
    // Structural: BL-702's own background scenario already proves the
    // principal+topic gate refuses before mutating anything; every
    // scenario below drives the principal's own messages only.
  });

  // ── /pilot refuses while the swarm is live ──────────────────────────────
  scoped(/^the swarm tmux session or handoffd is live$/, (ctx) => {
    mkFixtureRoot(ctx);
    writeLiveSessionFixture(ctx.root, 'coder');
  });

  // ── /hydrate refuses when a full-pack role is up ────────────────────────
  scoped(/^a non-specifier pipeline role session is live$/, (ctx) => {
    mkFixtureRoot(ctx);
    writeLiveSessionFixture(ctx.root, 'coder');
  });

  // ── the shared "When the principal sends" dispatcher ────────────────────
  scoped(/^the principal sends "([^"]+)"$/, async (ctx, text) => {
    mkFixtureRoot(ctx);
    const base = text.trim().split(/\s+/)[0].toLowerCase();
    if (base === '/pilot' || base === '/hydrate' || base === '/stop') {
      const live = liveCtx(ctx);
      const decision = bridgeCore().decideInboundAction(inboundEvent(text), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID);
      ctx.decision = decision;
      await withFakeTmuxOnPath(ctx.root, () =>
        bridgeLive().handleInboundDecision(decision, live, undefined, async () => {})
      );
      return;
    }
    const parts = text.trim().split(/\s+/);
    const verb = parts[0];
    const args = parts.slice(1).join(' ') || undefined;
    ctx.result = operatorExec().executeOperatorVerb(ctx.root, verb, args, { principalId: PRINCIPAL_ID });
  });

  scoped(/^the bridge refuses without starting a Cursor expedition$/, (ctx) => {
    assert.ok(ctx.posts.length > 0, 'expected a refusal reply to be posted');
    assert.match(ctx.posts[ctx.posts.length - 1], /^Cannot pilot BL-698: swarm is live/);
  });

  scoped(/^the reply names what is live$/, (ctx) => {
    assert.match(ctx.posts[ctx.posts.length - 1], /\(coder\)/);
  });

  scoped(/^the bridge refuses without starting the specifier-only wake$/, (ctx) => {
    assert.ok(ctx.posts.length > 0, 'expected a refusal reply to be posted');
    assert.match(ctx.posts[ctx.posts.length - 1], /^Cannot \/hydrate: full-pack pipeline role\(s\) up \(coder\)\./);
    assert.equal(
      bridgeLive().readPendingOperatorConfirm(ctx.root),
      undefined,
      'no confirm may be pending - the specifier-only wake never started'
    );
  });

  // ── Soft lifecycle verbs need a light confirm before run (/pull) ───────
  scoped(/^the principal sends "([^"]+)" in Cursor Remote$/, async (ctx, text) => {
    const live = liveCtx(ctx);
    const decision = bridgeCore().decideInboundAction(inboundEvent(text), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID);
    ctx.decision = decision;
    await bridgeLive().handleInboundDecision(decision, live, undefined, async () => {});
  });

  scoped(/^the bridge prompts for a single Confirm tap and does not run yet$/, (ctx) => {
    const last = ctx.posts[ctx.posts.length - 1];
    assert.match(last, /^Confirm \/pull\? One tap to run\./);
    const pending = bridgeLive().readPendingOperatorConfirm(ctx.root);
    assert.deepEqual(pending, { tier: 'soft', verb: '/pull' });
  });

  scoped(/^the principal confirms$/, async (ctx) => {
    const live = liveCtx(ctx);
    const pending = bridgeLive().readPendingOperatorConfirm(ctx.root);
    assert.ok(pending, 'expected a pending operator confirm to read back from disk');
    const decision = bridgeCore().decideInboundAction(
      callbackEvent(operatorCore().OPERATOR_CALLBACK_DATA.confirm),
      PRINCIPAL_ID,
      CHAT_ID,
      CURSOR_TOPIC_ID,
      pending
    );
    ctx.decision = decision;
    await bridgeLive().handleInboundDecision(decision, live, undefined, async () => {});
  });

  scoped(/^the verb runs and a short result is posted to the topic$/, (ctx) => {
    const last = ctx.posts[ctx.posts.length - 1];
    assert.match(last, /^pull:/);
    assert.equal(
      bridgeLive().readPendingOperatorConfirm(ctx.root),
      undefined,
      'pending confirm must be cleared once the verb runs'
    );
  });

  // ── /stop offers drain-stop and emergency-stop modes ────────────────────
  scoped(/^the bridge prompts for stop mode selection$/, (ctx) => {
    const last = ctx.posts[ctx.posts.length - 1];
    assert.equal(
      last,
      'Stop the swarm? Choose drain-stop (wait for empty pipeline, then kill) or emergency-stop (kill now).'
    );
    const pending = bridgeLive().readPendingOperatorConfirm(ctx.root);
    assert.equal(pending && pending.verb, '/stop');
  });

  scoped(/^only the chosen mode executes after confirm$/, async (ctx) => {
    const live = liveCtx(ctx);
    const pending = bridgeLive().readPendingOperatorConfirm(ctx.root);
    assert.ok(pending && pending.verb === '/stop', 'expected a pending /stop confirm to act on');
    const decision = bridgeCore().decideInboundAction(
      callbackEvent(operatorCore().OPERATOR_CALLBACK_DATA.stopDrain),
      PRINCIPAL_ID,
      CHAT_ID,
      CURSOR_TOPIC_ID,
      pending
    );
    assert.deepEqual(decision, { action: 'stop-mode', mode: 'drain' });
    await bridgeLive().handleInboundDecision(decision, live, undefined, async () => {});
    const last = ctx.posts[ctx.posts.length - 1];
    assert.match(last, /^Drain-stop:/);
    assert.ok(!/^Emergency stop/.test(last), 'only the chosen (drain) mode may run');
    assert.equal(
      bridgeLive().readPendingOperatorConfirm(ctx.root),
      undefined,
      'pending confirm must be cleared once the mode executes'
    );
  });

  // ── /ambulance engages and releases exclusive hold ──────────────────────
  scoped(/^the principal confirms "([^"]+)"$/, (ctx, cmd) => {
    mkFixtureRoot(ctx);
    const parts = cmd.trim().split(/\s+/);
    const verb = parts[0];
    const args = parts.slice(1).join(' ') || undefined;
    if (verb === '/ambulance' && args && /^BL-\d+$/i.test(args)) {
      ensureActiveTicket(ctx.root, args.toUpperCase());
    }
    ctx.result = operatorExec().executeOperatorVerb(ctx.root, verb, args, { principalId: PRINCIPAL_ID });
  });

  scoped(/^ambulance mode is engaged for BL-698$/, (ctx) => {
    assert.match(ctx.result.text, /^Ambulance engaged for BL-698/);
    const marker = ambulanceLib().readRawAmbulanceMarker(ctx.root);
    assert.equal(marker && marker.active, true);
    assert.equal(marker.ticket, 'BL-698');
  });

  scoped(/^ambulance mode is released$/, (ctx) => {
    assert.match(ctx.result.text, /^Ambulance released/);
    const marker = ambulanceLib().readRawAmbulanceMarker(ctx.root);
    assert.equal(marker ? marker.active : false, false);
  });

  // ── /hold parks to backlog/hold and /reinstate restores ─────────────────
  scoped(/^ticket BL-697 lives under backlog\/paused\/$/, (ctx) => {
    mkFixtureRoot(ctx);
    writeTicketYaml(ctx.root, 'paused', 'BL-697');
  });

  scoped(/^BL-697 is filed under backlog\/hold\/$/, (ctx) => {
    assert.ok(fs.existsSync(ticketPath(ctx.root, 'hold', 'BL-697')));
    assert.ok(!fs.existsSync(ticketPath(ctx.root, 'paused', 'BL-697')));
    assert.match(ctx.result.text, /^hold: BL-697 parked under backlog\/hold\//);
  });

  scoped(/^BL-697 is no longer under backlog\/hold\/$/, (ctx) => {
    assert.ok(!fs.existsSync(ticketPath(ctx.root, 'hold', 'BL-697')));
    assert.ok(fs.existsSync(ticketPath(ctx.root, 'paused', 'BL-697')));
    assert.match(ctx.result.text, /^reinstate: BL-697 restored to backlog\/paused\//);
  });

  // ── /autopilot dry lists high-priority specced tickets and defects ─────
  scoped(
    /^live tickets include a high-severity approved item, a defect-typed approved item, and a pending-approval item$/,
    (ctx) => {
      mkFixtureRoot(ctx);
      writeTicketYaml(ctx.root, 'paused', 'BL-900', {
        title: 'High severity fixture',
        severity: 'high',
        humanApproval: 'approved',
        acceptance: 'specs/features/fake.feature',
        priority: 10,
      });
      writeTicketYaml(ctx.root, 'paused', 'BL-901', {
        title: 'Defect fixture',
        type: 'defect',
        humanApproval: 'approved',
        acceptance: 'specs/features/fake.feature',
        priority: 20,
      });
      writeTicketYaml(ctx.root, 'paused', 'BL-902', {
        title: 'Pending approval fixture',
        type: 'defect',
        severity: 'critical',
        humanApproval: 'pending',
        acceptance: 'specs/features/fake.feature',
        priority: 5,
      });
    }
  );

  scoped(/^the reply lists the high-severity approved item$/, (ctx) => {
    assert.match(ctx.result.text, /BL-900/);
  });

  scoped(/^the reply lists the defect-typed approved item$/, (ctx) => {
    assert.match(ctx.result.text, /BL-901/);
  });

  scoped(/^the reply does not list the pending-approval item$/, (ctx) => {
    assert.doesNotMatch(ctx.result.text, /BL-902/);
  });

  scoped(/^no Cursor expedition starts$/, (ctx) => {
    assert.ok(!ctx.result.pilotQueue || ctx.result.pilotQueue.length === 0);
  });

  // ── /land dry lists in-flight tickets only ──────────────────────────────
  scoped(/^one ticket in backlog\/active\/ and one only in backlog\/paused\/$/, (ctx) => {
    mkFixtureRoot(ctx);
    writeTicketYaml(ctx.root, 'active', 'BL-910', { title: 'Active fixture', priority: 1 });
    writeTicketYaml(ctx.root, 'paused', 'BL-911', { title: 'Paused-only fixture', priority: 2 });
  });

  scoped(/^the reply lists the active ticket$/, (ctx) => {
    assert.match(ctx.result.text, /BL-910/);
  });

  scoped(/^the reply does not list the paused-only ticket$/, (ctx) => {
    assert.doesNotMatch(ctx.result.text, /BL-911/);
  });

  // ── Control topic accepts the same slash forms as Cursor Remote ────────
  scoped(/^the principal sends "([^"]+)" in the Control topic$/, (ctx, text) => {
    mkFixtureRoot(ctx);
    ensureActiveTicket(ctx.root, 'BL-698');
    const decision = controlCore().decideControlEventAction(
      { kind: 'text', text, fromId: PRINCIPAL_ID, topicId: CONTROL_TOPIC_ID },
      PRINCIPAL_ID,
      CONTROL_TOPIC_ID,
      undefined,
      { active: false }
    );
    assert.deepEqual(decision, { action: 'engage-ambulance', ticket: 'BL-698' });
    ctx.cursorRemoteResult = operatorExec().executeOperatorVerb(ctx.root, '/ambulance', decision.ticket, {
      principalId: PRINCIPAL_ID,
    });
    ctx.controlResult = ambulanceLib().engageOperatorAmbulance(ctx.root, decision.ticket);
  });

  scoped(/^ambulance engages with the same backend as Cursor Remote$/, (ctx) => {
    assert.equal(ctx.controlResult.ok, true);
    assert.equal(ctx.controlResult.text, ctx.cursorRemoteResult.text);
    const marker = ambulanceLib().readRawAmbulanceMarker(ctx.root);
    assert.equal(marker.active, true);
    assert.equal(marker.ticket, 'BL-698');
  });
}

module.exports = { registerSteps };
