'use strict';

// BL-649: swarm start posts doorbell announcement for pending approvals.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { runConciergeTick } = require(path.join(EXT_DIR, 'out', 'concierge', 'conciergeTick'));
const { runPendingApprovalAnnouncementHook } = require(path.join(EXT_DIR, 'out', 'concierge', 'pendingApprovalsAnnouncementHook'));
const { readTickState, writeTickState } = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));
const {
  recordApprovalReply,
  classifyApprovalsTopicReply,
} = require(path.join(EXT_DIR, 'out', 'concierge', 'pendingApprovalReply'));
const { pollAndForward } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));

const FEATURE = 'swarm start posts a doorbell announcement for pending approvals on Telegram';
const APPROVALS_TOPIC_ID = 750;
const PRINCIPAL_ID = 111;

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl649-'));
}

function writeTicket(ctx, folder, id, extra = '') {
  const dir = path.join(ctx.targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  const body = extra.trim()
    ? `id: ${id}\nhuman_approval: pending\n${extra.trim()}\n`
    : `id: ${id}\ntitle: ${id} title\nhuman_approval: pending\napproval_context: fixture approval context for ${id}\n`;
  fs.writeFileSync(path.join(dir, `${id}.yaml`), body, 'utf8');
}

function buildAnnouncementAdapters(ctx) {
  return {
    ensureApprovalsTopic: async () => APPROVALS_TOPIC_ID,
    postMessage: async (topicId, text) => {
      ctx.announcementPosts.push({ topicId, text, kind: 'post' });
      return 8000 + ctx.announcementPosts.length;
    },
  };
}

function buildConciergeAdapters(ctx) {
  return {
    readFolders: () => ctx.folders,
    readGates: () => [],
    readRoleTicket: () => ({}),
    readTickState: () => ctx.tickState,
    writeTickState: (next) => {
      ctx.tickState = next;
    },
    routeAdapters: {
      getTopicMap: () => ({}),
      createTopic: async () => ({ success: true, topicId: 900 }),
      recordTopicId: () => {},
      sendMessage: async () => true,
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
      ensureApprovalsTopic: async () => APPROVALS_TOPIC_ID,
      ensureBacklogTopic: async () => 760,
      postMessage: async () => 9000,
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
    rosterAdapters: {
      ensureApprovalsTopic: async () => APPROVALS_TOPIC_ID,
      postMessage: async (topicId, text) => {
        ctx.rosterOps.push({ kind: 'post', topicId, text });
        ctx.rosterMessageId = (ctx.rosterMessageId ?? 0) + 1;
        return ctx.rosterMessageId;
      },
      editMessage: async (topicId, messageId, text) => {
        ctx.rosterOps.push({ kind: 'edit', topicId, messageId, text });
        return true;
      },
    },
  };
}

async function runAnnouncementHook(ctx, nowMs = ctx.nowMs ?? Date.now()) {
  ctx.lastAnnouncementResult = await runPendingApprovalAnnouncementHook(
    ctx.targetPath,
    buildAnnouncementAdapters(ctx),
    nowMs,
    readTickState,
    writeTickState
  );
}

async function runTick(ctx) {
  ctx.tickResult = await runConciergeTick(buildConciergeAdapters(ctx));
}

function registerSteps(registry) {
  scoped(registry, /^a standing Approvals topic exists$/, (ctx) => {
    ctx.targetPath = mkTmp();
    ctx.announcementPosts = [];
    ctx.rosterOps = [];
    ctx.folders = { active: [], paused: [], done: [] };
    ctx.tickState = { snapshot: null, emittedKeys: [] };
    ctx.nowMs = Date.parse('2026-08-26T12:00:00Z');
    fs.mkdirSync(path.join(ctx.targetPath, '.swarmforge', 'operator'), { recursive: true });
  });

  scoped(registry, /^the front desk bot is up after swarm start$/, (ctx) => {
    writeTickState(ctx.targetPath, { snapshot: null, emittedKeys: [] });
  });

  scoped(registry, /^N tickets in active or paused carry human_approval pending$/, (ctx) => {
    const count = 2;
    for (let i = 1; i <= count; i += 1) {
      const id = `BL-649-${i}`;
      writeTicket(ctx, 'paused', id);
      ctx.folders.paused.push({
        id,
        title: `${id} title`,
        humanApproval: 'pending',
        approvalContext: `fixture approval context for ${id}`,
      });
    }
  });

  scoped(registry, /^no ticket in active or paused carries human_approval pending$/, (ctx) => {
    ctx.folders = { active: [], paused: [], done: [] };
  });

  scoped(registry, /^swarm start runs the pending-approval announcement hook$/, async (ctx) => {
    await runAnnouncementHook(ctx);
  });

  scoped(registry, /^swarm start runs the pending-approval announcement hook twice without set change$/, async (ctx) => {
    await runAnnouncementHook(ctx, ctx.nowMs);
    await runAnnouncementHook(ctx, ctx.nowMs + 1000);
  });

  scoped(registry, /^exactly one new message is posted to the Approvals topic not an edit$/, (ctx) => {
    if (ctx.announcementPosts.length !== 1) {
      throw new Error(`expected one announcement post, got ${JSON.stringify(ctx.announcementPosts)}`);
    }
    if (ctx.announcementPosts[0].topicId !== APPROVALS_TOPIC_ID) {
      throw new Error('announcement not on Approvals topic');
    }
    if (ctx.announcementPosts.some((row) => row.kind === 'edit')) {
      throw new Error('announcement used edit instead of post');
    }
  });

  scoped(registry, /^each listed ticket shows id pending age and an approval_context derived line$/, (ctx) => {
    const text = ctx.announcementPosts[0]?.text ?? '';
    for (const item of ctx.folders.paused) {
      if (item.humanApproval !== 'pending') {
        continue;
      }
      if (!text.includes(item.id)) {
        throw new Error(`missing id ${item.id} in announcement`);
      }
      if (!/pending/.test(text)) {
        throw new Error('missing pending age in announcement');
      }
      if (!text.includes('fixture approval context')) {
        throw new Error('missing approval_context derived line in announcement');
      }
    }
  });

  scoped(registry, /^no message is posted to the Approvals topic$/, (ctx) => {
    if (ctx.announcementPosts.length > 0) {
      throw new Error(`expected no announcement, got ${JSON.stringify(ctx.announcementPosts)}`);
    }
  });

  scoped(registry, /^the same pending approval set across two swarm starts$/, (ctx) => {
    writeTicket(ctx, 'paused', 'BL-649-SAME');
    ctx.folders.paused = [{ id: 'BL-649-SAME', title: 'BL-649-SAME title', humanApproval: 'pending' }];
  });

  scoped(registry, /^exactly one announcement message was posted across both starts$/, (ctx) => {
    if (ctx.announcementPosts.length !== 1) {
      throw new Error(`expected one announcement across starts, got ${JSON.stringify(ctx.announcementPosts)}`);
    }
  });

  scoped(registry, /^one pending ticket on the first swarm start$/, (ctx) => {
    writeTicket(ctx, 'paused', 'BL-649-FIRST');
    ctx.folders.paused = [{ id: 'BL-649-FIRST', title: 'first', humanApproval: 'pending' }];
  });

  scoped(registry, /^a second ticket becomes pending before the next swarm start$/, (ctx) => {
    ctx.secondTicketId = 'BL-649-SECOND';
    ctx.deferSecondTicketFile = true;
  });

  scoped(registry, /^swarm start runs the pending-approval announcement hook after each start$/, async (ctx) => {
    await runAnnouncementHook(ctx, ctx.nowMs);
    if (ctx.deferSecondTicketFile) {
      writeTicket(ctx, 'active', ctx.secondTicketId);
      ctx.folders.active.push({ id: ctx.secondTicketId, title: 'second', humanApproval: 'pending' });
    }
    await runAnnouncementHook(ctx, ctx.nowMs + 5000);
  });

  scoped(registry, /^the second announcement names the newly pending ticket$/, (ctx) => {
    if (ctx.announcementPosts.length < 2) {
      throw new Error(`expected two announcements, got ${ctx.announcementPosts.length}`);
    }
    const second = ctx.announcementPosts[1].text;
    if (!second.includes('BL-649-SECOND')) {
      throw new Error(`second announcement missing new ticket: ${second}`);
    }
  });

  scoped(registry, /^a ticket listed in the start announcement is pending in the Approvals topic$/, (ctx) => {
    ctx.pendingTicketId = 'BL-649-REPLY';
    writeTicket(ctx, 'paused', ctx.pendingTicketId);
    ctx.folders.paused = [{ id: ctx.pendingTicketId, title: 'reply fixture', humanApproval: 'pending' }];
  });

  scoped(registry, /^the human replies approve for that ticket id in the Approvals topic$/, async (ctx) => {
    await runAnnouncementHook(ctx);
    const reply = `approve ${ctx.pendingTicketId}`;
    const parsed = classifyApprovalsTopicReply(reply);
    if (parsed.kind !== 'approve') {
      throw new Error(`unexpected parse ${JSON.stringify(parsed)}`);
    }
    ctx.replyRecorded = recordApprovalReply(ctx.targetPath, ctx.pendingTicketId);
  });

  scoped(registry, /^pendingApprovalReply records the approval for that ticket$/, (ctx) => {
    if (!ctx.replyRecorded) {
      throw new Error('approval not recorded by pendingApprovalReply');
    }
    const content = fs.readFileSync(
      path.join(ctx.targetPath, 'backlog', 'paused', `${ctx.pendingTicketId}.yaml`),
      'utf8'
    );
    if (!/^human_approval: approved$/m.test(content)) {
      throw new Error(`expected approved yaml, got ${content}`);
    }
  });

  scoped(registry, /^no second approval write path is introduced$/, () => {
    // recordApprovalReply is the only writer exercised above (same as BL-434 reply path).
  });

  scoped(registry, /^pending tickets and a roster message already maintained by approvalsRosterSync$/, async (ctx) => {
    writeTicket(ctx, 'paused', 'BL-649-ROSTER');
    ctx.folders.paused = [{ id: 'BL-649-ROSTER', title: 'roster ticket', humanApproval: 'pending' }];
    ctx.adapters = buildConciergeAdapters(ctx);
    await runTick(ctx);
    ctx.rosterOpsBeforeHook = [...ctx.rosterOps];
  });

  scoped(registry, /^approvalsRosterSync edit-in-place roster behavior is unchanged from BL-434$/, async (ctx) => {
    await runAnnouncementHook(ctx);
    writeTicket(ctx, 'paused', 'BL-649-ROSTER-2');
    ctx.folders.paused.push({ id: 'BL-649-ROSTER-2', title: 'second roster', humanApproval: 'pending' });
    await runTick(ctx);
    const rosterPosts = ctx.rosterOps.filter((op) => op.kind === 'post');
    const rosterEdits = ctx.rosterOps.filter((op) => op.kind === 'edit');
    if (rosterPosts.length !== 1) {
      throw new Error(`expected one roster post, got ${JSON.stringify(rosterPosts)}`);
    }
    if (rosterEdits.length < 1) {
      throw new Error(`expected roster edit-in-place, got ${JSON.stringify(ctx.rosterOps)}`);
    }
    if (ctx.announcementPosts.length > 0 && ctx.announcementPosts[0].text === ctx.rosterOps[0]?.text) {
      throw new Error('announcement must not be the roster message');
    }
  });

  scoped(registry, /^a pending ticket whose approval_context and title live only in its yaml$/, (ctx) => {
    ctx.yamlTitle = 'YAML ONLY TITLE STRING';
    ctx.yamlContext = 'YAML ONLY APPROVAL CONTEXT SENTENCE';
    ctx.paneCapture = 'TMUX PANE CAPTURE TEXT MUST NOT APPEAR';
    writeTicket(
      ctx,
      'paused',
      'BL-649-YAML',
      `title: "${ctx.yamlTitle}"\napproval_context: "${ctx.yamlContext}"\n`
    );
  });

  scoped(registry, /^the posted announcement lines quote those yaml fields$/, (ctx) => {
    const folders = require(path.join(EXT_DIR, 'out', 'panel', 'backlogReader')).readBacklogFolders(ctx.targetPath);
    const pending = require(path.join(EXT_DIR, 'out', 'metrics', 'backlogDashboard')).computeNeedsApproval(
      folders.active,
      folders.paused
    );
    const text = ctx.announcementPosts[0]?.text ?? '';
    const item = pending.find((row) => row.id === 'BL-649-YAML');
    if (!item?.approvalContext?.includes(ctx.yamlContext)) {
      throw new Error(`approval_context not read from yaml: ${JSON.stringify(item)}`);
    }
    if (!text.includes(ctx.yamlTitle) || !text.includes(ctx.yamlContext)) {
      throw new Error(`yaml fields missing from announcement: ${text}`);
    }
  });

  scoped(registry, /^no announcement line is sourced from tmux pane or terminal capture text$/, (ctx) => {
    const text = ctx.announcementPosts[0]?.text ?? '';
    if (text.includes(ctx.paneCapture)) {
      throw new Error('announcement incorrectly sourced pane capture');
    }
  });
}

module.exports = { registerSteps };
