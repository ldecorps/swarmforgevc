'use strict';

// BL-1425: step handlers for "a queue-jump places the ticket on the
// pipeline past the depth cap". Drives REAL compiled production code -
// promoteToActive/backlogWriter.ts (which shells to the REAL
// promotion_gates_cli.bb, never a fabricated verdict) for scenario 01, and
// recordExpediteDecisionAndClose/telegramFrontDeskBotCore.ts (pure, per the
// ticket's own direction) for scenario 02 - against a fixture root under a
// temporary directory, never the live checkout.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const { promoteToActive } = require(path.join(EXT_DIR, 'out', 'panel', 'backlogWriter'));
const { recordExpediteDecisionAndClose } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
const { installPromotionGates } = require('./lib/promotionGatesFixture');

const FEATURE = 'BL-1425 A queue-jump places the ticket on the pipeline past the depth cap';
const MAX_DEPTH = 2;

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl1425-qjump-'));
}

function writeTicket(root, folder, id, extra) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-p.yaml`), `id: ${id}\ntitle: t\n${extra || ''}`);
}

function inFolder(root, folder, id) {
  const dir = path.join(root, 'backlog', folder);
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((f) => f.startsWith(`${id}-`));
}

function locateFolder(root, id) {
  for (const folder of ['active', 'paused', 'hold', 'done']) {
    if (inFolder(root, folder, id)) return folder;
  }
  return 'nowhere';
}

// Every <ticket> variant the Outline names, built against a fixture root
// already AT the depth cap (installed by the Background).
const TICKET_FIXTURES = {
  'a paused ticket only the full depth cap refuses': (root, id) => {
    writeTicket(root, 'paused', id, 'human_approval: approved\ndepends_on: []\n');
    return 'paused';
  },
  'a paused ticket refused for depends_on': (root, id) => {
    // depends_on sits BEFORE active_backlog_max_depth in the gate chain
    // (first failing gate wins), so this refuses for depends_on even
    // though the Background's fixture is also at the cap - proving a
    // queue-jump crosses ONLY the depth gate, never this one.
    writeTicket(root, 'paused', id, 'human_approval: approved\ndepends_on: [BL-9200]\n');
    return 'paused';
  },
  'a held ticket': (root, id) => {
    writeTicket(root, 'hold', id, 'human_approval: approved\ndepends_on: []\n');
    return 'hold';
  },
  'a paused ticket with status blocked': (root, id) => {
    writeTicket(root, 'paused', id, 'status: blocked\nhuman_approval: approved\ndepends_on: []\n');
    return 'paused';
  },
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a fixture root whose backlog\/active already holds as many tickets as active_backlog_max_depth allows$/, (ctx) => {
    ctx.root = installPromotionGates(mkTmp(), { maxDepth: MAX_DEPTH });
    for (let i = 0; i < MAX_DEPTH; i += 1) {
      writeTicket(ctx.root, 'active', `BL-910${i}`, '');
    }
  });

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  scoped(/^a candidate that is (.+)$/, (ctx, ticket) => {
    const build = TICKET_FIXTURES[ticket];
    if (!build) {
      throw new Error(`unknown <ticket>: ${ticket}`);
    }
    ctx.candidateId = 'BL-9999';
    ctx.startFolder = build(ctx.root, ctx.candidateId);
  });

  scoped(/^the candidate is promoted (as a queue-jump|without a queue-jump)$/, (ctx, mode) => {
    const queueJump = mode === 'as a queue-jump';
    ctx.result = promoteToActive(ctx.root, ctx.candidateId, { queueJump });
  });

  scoped(/^the candidate ends up in (\w+)$/, (ctx, folder) => {
    const actual = locateFolder(ctx.root, ctx.candidateId);
    assertEqual(actual, folder, `expected the candidate to end up in ${folder}, found it in ${actual}`);
  });

  scoped(/^the verdict (.+)$/, (ctx, verdict) => {
    if (verdict.startsWith('says the depth cap was crossed')) {
      if (!ctx.result.crossed) {
        throw new Error(`expected a crossed depth-cap verdict, got: ${JSON.stringify(ctx.result)}`);
      }
      if (!/active count \d+ >= cap \d+/.test(ctx.result.crossed.reason)) {
        throw new Error(`expected the crossing to name the active count and the cap, got: ${ctx.result.crossed.reason}`);
      }
      assertEqual(ctx.result.crossed.gate, 'active_backlog_max_depth', 'expected the crossed gate to be active_backlog_max_depth');
    } else {
      const m = verdict.match(/^names the (\S+) gate as refusing$/);
      if (!m) {
        throw new Error(`unrecognised <verdict>: ${verdict}`);
      }
      const expectedGate = m[1] === 'hold' ? 'hold marker' : m[1];
      if (!ctx.result.refusal) {
        throw new Error(`expected a refusal naming ${expectedGate}, got: ${JSON.stringify(ctx.result)}`);
      }
      assertEqual(ctx.result.refusal.gate, expectedGate, `expected the refusing gate to be ${expectedGate}`);
    }
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  // Pure per the ticket's own direction: drives recordExpediteDecisionAndClose
  // with a stub promoteTicketIfPaused that answers the richer {crossed}
  // outcome directly - never a fixture root, never the real gates CLI.
  scoped(/^the queue-jump promotion of (\S+) reported the depth cap crossed$/, (ctx, backlogId) => {
    ctx.backlogId = backlogId;
    ctx.notified = [];
    ctx.editCalls = [];
    ctx.crossedReason = 'active count 7 >= cap 6';
  });

  scoped(/^the Q jump tap for (\S+) is delivered$/, async (ctx) => {
    ctx.result = await recordExpediteDecisionAndClose(
      {
        recordApprovalReply: async () => true,
        promoteTicketIfPaused: async () => ({ moved: true, crossed: { gate: 'active_backlog_max_depth', reason: ctx.crossedReason } }),
        commitExpediteWrites: async () => undefined,
        checkExpediteFileCollision: async () => undefined,
        dispatchExpediteBuild: async () => true,
        notifyApprovalsTopic: async (topicId, text) => {
          ctx.notified.push({ topicId, text });
          return true;
        },
        readApprovalAskMessage: async () => ({ topicId: 1, messageId: 1, text: `${ctx.backlogId}: awaiting decision` }),
        editApprovalAskMessage: async (topicId, messageId, text) => {
          ctx.editCalls.push({ topicId, messageId, text });
          return { success: true };
        },
      },
      ctx.backlogId,
      Date.now()
    );
  });

  scoped(/^the Approvals topic is told the cap was crossed, naming the active count and the cap$/, (ctx) => {
    const notice = ctx.notified.find((n) => /past the active_backlog_max_depth cap/.test(n.text));
    if (!notice) {
      throw new Error(`expected an Approvals-topic notice naming the crossed cap, got: ${JSON.stringify(ctx.notified)}`);
    }
    if (!notice.text.includes(ctx.crossedReason)) {
      throw new Error(`expected the notice to carry "${ctx.crossedReason}", got: ${notice.text}`);
    }
  });

  scoped(/^the ask closes with the Q jumped decision line as today$/, (ctx) => {
    const edited = ctx.editCalls[ctx.editCalls.length - 1];
    if (!edited || !/-- Q jumped \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/.test(edited.text)) {
      throw new Error(`expected a "-- Q jumped <UTC>" decision line, got: ${JSON.stringify(edited)}`);
    }
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  const COORDINATOR_DAEMON_SCRIPTS = [
    'swarmforge/scripts/promote_and_route_next.sh',
    'swarmforge/scripts/route_backlog_to_coder.sh',
    'swarmforge/scripts/handoffd.bb',
    'swarmforge/scripts/chase_sweep_lib.bb',
  ];

  scoped(/^the promotion scripts the coordinator and the daemon run are read$/, (ctx) => {
    ctx.scriptContents = COORDINATOR_DAEMON_SCRIPTS.map((rel) => ({
      rel,
      content: fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'),
    }));
  });

  scoped(/^none of them invokes the chokepoint in queue-jump mode$/, (ctx) => {
    const offenders = ctx.scriptContents.filter(
      ({ content }) => content.includes('--queue-jump') || content.includes('queue-jump?')
    );
    if (offenders.length > 0) {
      throw new Error(`expected none of the coordinator/daemon scripts to declare queue-jump mode, found it in: ${offenders.map((o) => o.rel).join(', ')}`);
    }
  });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (actual: ${JSON.stringify(actual)}, expected: ${JSON.stringify(expected)})`);
  }
}

module.exports = { registerSteps };
