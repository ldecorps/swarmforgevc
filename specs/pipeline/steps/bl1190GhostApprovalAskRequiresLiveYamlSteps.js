'use strict';

// BL-1190: step handlers for "Approval ask cannot outlive its backlog
// yaml" - the ghost-ask systemic fix (BL-1186 incident). Every scenario
// drives the REAL machinery over a fixture swarm root: the compiled
// conciergeTick.ts tick body, telegramFrontDeskBotCore.ts's real
// recordApprovalDecisionAndClose/reconcileStaleApprovalAsks, and
// pendingApprovalFor.ts's real findTicketFilePath against real files on
// disk. Telegram itself is the only stubbed boundary (route/close adapters
// simply record what they were called with).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'Approval ask cannot outlive its backlog yaml';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out');

function conciergeTickCore() {
  return require(path.join(OUT, 'concierge', 'conciergeTick'));
}

function botCore() {
  return require(path.join(OUT, 'tools', 'telegramFrontDeskBotCore'));
}

function pendingApprovalFor() {
  return require(path.join(OUT, 'concierge', 'pendingApprovalFor'));
}

function pendingApprovalReply() {
  return require(path.join(OUT, 'concierge', 'pendingApprovalReply'));
}

function mintDurabilityGate() {
  return require(path.join(OUT, 'concierge', 'mintDurabilityGate'));
}

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1190-acc-'));
  ctx.root = root;
  ctx.sent = [];
  ctx.recorded = [];
  ctx.askMessages = {};
  ctx.closed = [];
  ctx.folders = { active: [], paused: [], done: [] };
  return root;
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = undefined;
  }
}

// A minimal, complete RouteAdapters + TopicIconAdapters stub - only the
// ApprovalRequested routing path (ensureApprovalsTopic/sendApprovalAsk/
// recordMessage/recordApprovalAskMessageId) is ever actually reached by
// these scenarios (the fixture ticket is epic-less, gate-less), but every
// required field is still present so an unexpected call never crashes with
// "is not a function" instead of failing the scenario's own assertion.
function conciergeAdapters(ctx) {
  const state = { snapshot: null, emittedKeys: [] };
  return {
    state,
    readFolders: () => ctx.folders,
    readGates: () => [],
    readRoleTicket: () => ({}),
    readTickState: () => state,
    writeTickState: (s) => {
      state.snapshot = s.snapshot;
      state.emittedKeys = s.emittedKeys;
    },
    ticketFileExists: (backlogId) => pendingApprovalFor().ticketFileExists(ctx.root, backlogId),
    routeAdapters: {
      getTopicMap: () => ({}),
      createTopic: async () => ({ success: true, topicId: 1 }),
      recordTopicId: () => {},
      sendMessage: async () => true,
      closeTopic: async () => true,
      recordMessage: (backlogId, text) => ctx.recorded.push({ backlogId, text }),
      ensureOperatorTopic: async () => 700,
      ensureApprovalsTopic: async () => 750,
      sendApprovalAsk: async (topicId, text, buttons) => {
        ctx.sent.push({ topicId, text, buttons });
        return { success: true, messageId: 42 + ctx.sent.length };
      },
      recordApprovalAskMessageId: (backlogId, topicId, messageId, text) => {
        ctx.askMessages[backlogId] = { topicId, messageId, text };
      },
      ensureBacklogTopic: async () => 760,
      postMessage: async () => 1,
      editMessage: async () => true,
      getTicketMessageState: () => undefined,
      setTicketMessageState: () => {},
    },
    iconAdapters: {
      getIconStickers: async () => [],
      setTopicIcon: async () => true,
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  };
}

function writeTicketYaml(root, folder, filename, id) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), `id: ${id}\ntitle: t\nhuman_approval: pending\n`);
}

function writeTopicRecord(root, id, topicId) {
  const dir = path.join(root, 'backlog', 'topics');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ topicId }));
}

// Close adapters used directly by reconcileStaleApprovalAsks /
// recordApprovalDecisionAndClose scenarios (02/03) - real closing routine
// (closeApprovalAskForBacklogId), Telegram edit stubbed to record its call.
function closeAdapters(ctx) {
  return {
    readApprovalAskMessage: async (backlogId) => ctx.askMessages[backlogId],
    editApprovalAskMessage: async (topicId, messageId, text) => {
      ctx.closed.push({ topicId, messageId, text });
      return { success: true };
    },
    persistClosedApprovalAskText: async (backlogId, text) => {
      if (ctx.askMessages[backlogId]) {
        ctx.askMessages[backlogId] = { ...ctx.askMessages[backlogId], text };
      }
    },
  };
}

function git(cwd, args) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  execFileSync('git', ['-C', cwd, ...args], { stdio: ['ignore', 'ignore', 'pipe'], env });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the front desk approval machinery is running against a fixture swarm root$/, (ctx) => {
    mkFixture(ctx);
  });

  // ── Scenario 01: refuse-post-without-yaml ──────────────────────────────
  scoped(/^ticket "([^"]+)" has a topic record but no yaml in backlog active or paused$/, (ctx, id) => {
    writeTopicRecord(ctx.root, id, 900);
    // The folder snapshot below simulates whatever stale/external source
    // (a topic record surviving its yaml) claimed this id is pending -
    // the fixture never writes a real yaml file for it, so the REAL
    // findTicketFilePath the pre-post gate calls genuinely finds nothing.
    ctx.folders = { active: [], paused: [{ id, title: 'ghost approval ask', humanApproval: 'pending' }], done: [] };
    ctx.gatedId = id;
  });

  scoped(/^the concierge evaluates pending approval for "([^"]+)"$/, async (ctx, id) => {
    try {
      const adapters = conciergeAdapters(ctx);
      ctx.tickAdapters = adapters;
      ctx.result = await conciergeTickCore().runConciergeTick(adapters);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^no ApprovalRequested event is emitted for "([^"]+)"$/, (ctx, id) => {
    try {
      assert.ok(
        !(ctx.tickAdapters.state.snapshot.pendingApproval || []).includes(id),
        `expected "${id}" to be gated out of pendingApproval, got: ${JSON.stringify(ctx.tickAdapters.state.snapshot.pendingApproval)}`
      );
      assert.ok(
        !ctx.tickAdapters.state.emittedKeys.includes(`ApprovalRequested:${id}`),
        `expected no ApprovalRequested emitted for "${id}", got: ${JSON.stringify(ctx.tickAdapters.state.emittedKeys)}`
      );
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^no buttoned approval ask is registered for "([^"]+)"$/, (ctx, id) => {
    try {
      assert.ok(!ctx.sent.some((m) => m.text.includes(`${id} needs your approval`)), `expected no ask sent for "${id}", got: ${JSON.stringify(ctx.sent)}`);
      assert.equal(ctx.askMessages[id], undefined);
    } finally {
      cleanup(ctx);
    }
  });

  // ── Scenario 02: stale-ask-reconcile ────────────────────────────────────
  scoped(/^ticket "([^"]+)" had a buttoned approval ask registered yesterday$/, (ctx, id) => {
    ctx.askMessages[id] = { topicId: 750, messageId: 5, text: `${id} needs your approval...` };
    ctx.reconcileId = id;
  });

  scoped(/^the yaml for "([^"]+)" no longer exists on disk$/, (ctx, id) => {
    assert.equal(pendingApprovalFor().findTicketFilePath(ctx.root, id), undefined, `expected no yaml on disk for "${id}"`);
  });

  scoped(/^the approval ask reconcile sweep runs$/, async (ctx) => {
    try {
      await botCore().reconcileStaleApprovalAsks(
        {
          readApprovalAskMessages: () => ctx.askMessages,
          ticketFileExists: (backlogId) => pendingApprovalFor().ticketFileExists(ctx.root, backlogId),
          closeApprovalAsk: (backlogId, verdict, nowMs) => botCore().closeApprovalAskForBacklogId(closeAdapters(ctx), backlogId, verdict, nowMs),
        },
        0
      );
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the ask for "([^"]+)" is closed or marked stale in the Approvals topic$/, (ctx, id) => {
    try {
      assert.ok(ctx.closed.length >= 1, `expected the ask for "${id}" to be closed, got: ${JSON.stringify(ctx.closed)}`);
      assert.match(ctx.closed[ctx.closed.length - 1].text, /-- Stale: ticket file missing/);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^tapping Approve returns an honest stale-ask outcome instead of a silent no-op loop$/, (ctx) => {
    try {
      const reason = pendingApprovalReply().explainApprovalRecordNoOp(ctx.root, ctx.reconcileId);
      assert.equal(reason, 'no-ticket-file', 'a repeat tap must still name an honest reason, never a silent no-op');
    } finally {
      cleanup(ctx);
    }
  });

  // ── Scenario 03: no-ticket-file-honest ──────────────────────────────────
  scoped(/^a buttoned approval ask exists for ticket "([^"]+)"$/, (ctx, id) => {
    ctx.askMessages[id] = { topicId: 750, messageId: 7, text: `${id} needs your approval...` };
    ctx.tapId = id;
  });

  scoped(/^no yaml exists for "([^"]+)"$/, (ctx, id) => {
    assert.equal(pendingApprovalFor().findTicketFilePath(ctx.root, id), undefined);
  });

  scoped(/^the principal taps Approve for "([^"]+)"$/, async (ctx, id) => {
    try {
      ctx.tapAdapters = {
        recordApprovalReply: (backlogId) => Promise.resolve(pendingApprovalReply().recordApprovalReply(ctx.root, backlogId)),
        recordRejectionReply: (backlogId, reason) => Promise.resolve(pendingApprovalReply().recordRejectionReply(ctx.root, backlogId, reason)),
        explainApprovalRecordNoOp: (backlogId) => Promise.resolve(pendingApprovalReply().explainApprovalRecordNoOp(ctx.root, backlogId)),
        ...closeAdapters(ctx),
      };
      ctx.tapResult = await botCore().recordApprovalDecisionAndClose(ctx.tapAdapters, id, { kind: 'approved' }, 0);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the tap records reason "([^"]+)"$/, (ctx, reason) => {
    try {
      assert.equal(ctx.tapResult.changed, false, 'a tap on a missing ticket must record no change');
      const explained = pendingApprovalReply().explainApprovalRecordNoOp(ctx.root, ctx.tapId);
      assert.equal(explained, reason);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the ask is removed or marked stale so repeat taps cannot recur indefinitely$/, (ctx) => {
    try {
      assert.ok(ctx.closed.length >= 1, 'expected the ghost ask to be closed inline, not left for the next sweep alone');
      assert.match(ctx.closed[ctx.closed.length - 1].text, /-- Stale: ticket file missing/);
    } finally {
      cleanup(ctx);
    }
  });

  // ── Scenario 04: mint-durability-gate ───────────────────────────────────
  scoped(
    /^the specifier announces spec-ready for "([^"]+)" without a committed paused yaml path$/,
    (ctx, id) => {
      try {
        git(ctx.root, ['init', '-q']);
        git(ctx.root, ['config', 'user.email', 'test@example.com']);
        git(ctx.root, ['config', 'user.name', 'Test']);
        git(ctx.root, ['commit', '--allow-empty', '-m', 'seed']);
        ctx.mintRelPath = `backlog/paused/${id}-slug.yaml`;
        writeTicketYaml(ctx.root, 'paused', `${id}-slug.yaml`, id);
        ctx.armed = false;
      } catch (e) {
        cleanup(ctx);
        throw e;
      }
    }
  );

  scoped(/^the mint durability gate runs for that handoff$/, (ctx) => {
    try {
      ctx.gateResult = mintDurabilityGate().attemptSpecReadyHandoff(ctx.root, ctx.mintRelPath, () => {
        ctx.armed = true;
      });
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the gate refuses with a reason naming the missing yaml path$/, (ctx) => {
    try {
      assert.equal(ctx.gateResult.refused, true);
      assert.ok(ctx.gateResult.reason && ctx.gateResult.reason.includes(ctx.mintRelPath), `expected the reason to name "${ctx.mintRelPath}", got: ${ctx.gateResult.reason}`);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^no ApprovalRequested path is armed for "([^"]+)"$/, (ctx) => {
    try {
      assert.equal(ctx.armed, false, 'a refused mint durability gate must never arm the ApprovalRequested path');
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
