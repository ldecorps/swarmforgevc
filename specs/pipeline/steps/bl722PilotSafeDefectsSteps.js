'use strict';

// BL-722: step handlers for /pilot safe's auto-pick safe pool. Drives the
// real compiled pilotSafeDefects.js filter+rank and
// telegramCursorBridgeCore.js decision layer directly against a scratch
// backlog/paused + specs/features tree - never a live daemon or Telegram
// event loop. Requires `npm run compile` in extension/ to have run first
// (the out/ compiled JS is the acceptance contract, same as every other
// extension-backed step file).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out', 'tools');

const { listSafePilotDefects, pickSafePilotDefect } = require(path.join(EXT_OUT, 'pilotSafeDefects.js'));
const { decideInboundAction } = require(path.join(EXT_OUT, 'telegramCursorBridgeCore.js'));

const CHAT_ID = '-100123';
const PRINCIPAL_ID = 42;
const CURSOR_TOPIC_ID = 7501;

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-pilot-safe-'));
    fs.mkdirSync(path.join(ctx.targetPath, 'backlog', 'paused'), { recursive: true });
    fs.mkdirSync(path.join(ctx.targetPath, 'specs', 'features'), { recursive: true });
    ctx.ticketSeq = 0;
  }
  return ctx.targetPath;
}

function nextId(ctx) {
  ctx.ticketSeq += 1;
  return `BL-${900 + ctx.ticketSeq}`;
}

function writeTicket(ctx, fields) {
  const id = nextId(ctx);
  const dir = path.join(ctx.targetPath, 'backlog', 'paused');
  const body = [
    `id: ${id}`,
    `title: "${fields.title || id}"`,
    `type: ${fields.type || 'defect'}`,
    `status: ${fields.status || 'todo'}`,
    `severity: ${fields.severity || 'medium'}`,
    `priority: ${fields.priority ?? 10}`,
    `human_approval: ${fields.human_approval || 'approved'}`,
    `mutation_cost: ${fields.mutation_cost || 'low'}`,
    `acceptance: specs/features/${id}-x.feature`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, `${id}.yaml`), body);
  if (fields.withFeature !== false) {
    fs.writeFileSync(path.join(ctx.targetPath, 'specs', 'features', `${id}-x.feature`), `Feature: ${id}\n`);
  }
  return id;
}

function event(text) {
  return { kind: 'text', fromId: PRINCIPAL_ID, chatId: CHAT_ID, topicId: CURSOR_TOPIC_ID, text };
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a repo backlog with paused ticket YAML and specs\/features$/, (ctx) => {
    ensureTargetPath(ctx);
  });

  // ── safe-01: safe list includes only matching defects ──────────────────
  registry.define(/^a paused approved defect with mutation_cost low and a real feature file$/, (ctx) => {
    ctx.firstTicketId = writeTicket(ctx, { mutation_cost: 'low', severity: 'high', priority: 1 });
  });

  registry.define(/^a paused approved defect with mutation_cost medium$/, (ctx) => {
    writeTicket(ctx, { mutation_cost: 'medium', severity: 'high', priority: 1 });
  });

  registry.define(/^a paused approved defect with status needs_design and mutation_cost low$/, (ctx) => {
    writeTicket(ctx, { mutation_cost: 'low', status: 'needs_design', severity: 'high', priority: 1 });
  });

  registry.define(/^I list the safe pilot pool$/, (ctx) => {
    ctx.listed = listSafePilotDefects(ctx.targetPath, { folder: 'paused' });
  });

  registry.define(/^only the first ticket appears$/, (ctx) => {
    const ids = ctx.listed.tickets.map((t) => t.id);
    if (ids.length !== 1 || ids[0] !== ctx.firstTicketId) {
      throw new Error(`expected only [${ctx.firstTicketId}] in the safe pool, got [${ids.join(', ')}]`);
    }
  });

  // ── safe-02: safe start picks the top-ranked ticket ─────────────────────
  registry.define(/^two paused safe defects differing by severity and priority$/, (ctx) => {
    const lower = writeTicket(ctx, { severity: 'medium', priority: 50 });
    const higher = writeTicket(ctx, { severity: 'high', priority: 1 });
    ctx.lowerRankedId = lower;
    ctx.expectedTopId = higher;
  });

  registry.define(/^I start \/pilot safe$/, (ctx) => {
    ctx.picked = pickSafePilotDefect(ctx.targetPath, { folder: 'paused' });
  });

  registry.define(/^the selected ticket is the higher-severity then lower-priority one$/, (ctx) => {
    if (ctx.picked.empty) {
      throw new Error('expected a selected ticket, but the safe pool reported empty');
    }
    if (ctx.picked.ticket.id !== ctx.expectedTopId) {
      throw new Error(`expected top-ranked ${ctx.expectedTopId}, got ${ctx.picked.ticket.id}`);
    }
  });

  registry.define(/^the selection rationale names the safe filter$/, (ctx) => {
    if (!/safe filter/i.test(ctx.picked.rationale || '')) {
      throw new Error(`selection rationale does not name the safe filter: ${JSON.stringify(ctx.picked.rationale)}`);
    }
  });

  // ── safe-03: empty safe pool does not start pilot ────────────────────────
  registry.define(/^no paused ticket matches the safe filter$/, (ctx) => {
    ensureTargetPath(ctx);
    // Deliberately no ticket fixtures written.
  });

  registry.define(/^no pilot run starts$/, (ctx) => {
    if (!ctx.picked || ctx.picked.empty !== true) {
      throw new Error(`expected an empty-pool result, got: ${JSON.stringify(ctx.picked)}`);
    }
  });

  registry.define(/^the operator is told the pool is empty$/, (ctx) => {
    if (typeof ctx.picked.reason !== 'string' || ctx.picked.reason.trim().length === 0) {
      throw new Error('expected a non-empty operator-facing reason when the safe pool is empty');
    }
  });

  // ── safe-04: explicit pilot by id still works ────────────────────────────
  registry.define(/^I run \/pilot BL-650$/, (ctx) => {
    ctx.decision = decideInboundAction(event('/pilot BL-650'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID);
  });

  registry.define(/^the pilot targets BL-650 regardless of the safe filter$/, (ctx) => {
    if (ctx.decision.action !== 'pilot' || ctx.decision.ticket !== 'BL-650') {
      throw new Error(`expected {action: 'pilot', ticket: 'BL-650'}, got ${JSON.stringify(ctx.decision)}`);
    }
  });
}

module.exports = { registerSteps };
