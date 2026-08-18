'use strict';

// BL-918: step handlers for "Periodic sampling telemetry is not a stall".
// Drives the REAL compiled composer (leanLedgerComposeStall.js, via its
// leanLedgerCompose.js barrel) and the REAL downstream consumers
// (leanLedger.js's foldLeanLedgerSnapshot, closingCeremony.js's
// buildClosingCeremonyPacket) against fixture chaser-telemetry files and
// completed-handoff windows - never a reimplementation of the
// classification or fold logic in this step file, mirroring
// bl820ClosingCeremonyLeanPassSteps.js's own discipline.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const FEATURE = 'Periodic sampling telemetry is not a stall';

const { composeAllLeanLedgerEvents, unrecognizedChaserTelemetryTypes } = require(path.join(EXT_OUT, 'metrics', 'leanLedgerCompose'));
const { CHASER_ATTENTION_SIGNAL_TYPES } = require(path.join(EXT_OUT, 'metrics', 'leanLedgerComposeStall'));
const { appendLeanLedgerEventIfNew, readLeanLedgerEvents } = require(path.join(EXT_OUT, 'metrics', 'leanLedgerStore'));
const { foldLeanLedgerSnapshot } = require(path.join(EXT_OUT, 'quality', 'leanLedger'));
const { buildClosingCeremonyPacket } = require(path.join(EXT_OUT, 'quality', 'closingCeremony'));

const SHIFT_KEY = '2026-08-07';
const WINDOW_START = `${SHIFT_KEY}T08:00:00Z`;
const WINDOW_END = `${SHIFT_KEY}T09:00:00Z`;
const MONTH_KEY = '2026-08';
const SAMPLE_TYPES = ['resource_sample', 'host_load_sample'];

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value is validated against an explicit lookup, never a bare passthrough -
// an eventType outside this set fails loudly instead of silently seeding a
// row the composer was never asked to classify.
const KNOWN_OUTLINE_EVENT_TYPES = {
  chase: 'chase',
  nudge: 'nudge',
  'dead-letter': 'dead-letter',
  respawn: 'respawn',
  resource_sample: 'resource_sample',
  host_load_sample: 'host_load_sample',
};

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl918-')));
}

function writeHandoff(dir, filename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, filename), lines.join('\n') + '\n\nbody\n');
}

function completedDir(worktree) {
  return path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'completed');
}

function writeChaserTelemetry(mainWorktreePath, monthKey, rows) {
  const dir = path.join(mainWorktreePath, '.swarmforge', 'telemetry');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `chaser-${monthKey}.jsonl`), rows.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

function flush(ctx) {
  writeChaserTelemetry(ctx.target, MONTH_KEY, ctx.telemetryRows);
}

function isoOffset(minutes) {
  return new Date(Date.parse(WINDOW_START) + minutes * 60000).toISOString();
}

function composeAndAppend(ctx, ticket) {
  const events = composeAllLeanLedgerEvents(ctx.target, ctx.roles, ticket);
  for (const event of events) {
    appendLeanLedgerEventIfNew(ctx.target, event);
  }
  return events;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a shift whose chaser telemetry holds both attention signals and periodic samples$/,
    (ctx) => {
      ctx.target = mkTmp();
      ctx.coderWt = mkTmp();
      writeHandoff(completedDir(ctx.coderWt), '00_a.handoff', {
        task: 'BL-9101-x',
        enqueued_at: WINDOW_START,
        dequeued_at: WINDOW_START,
        completed_at: WINDOW_END,
      });
      ctx.roles = [{ role: 'coder', worktreeName: 'coder', worktreePath: ctx.coderWt }];
      ctx.telemetryRows = [
        { type: 'chase', role: 'coder', at: isoOffset(1), count: 1 },
        { type: 'resource_sample', role: 'coder', at: isoOffset(2), count: null },
      ];
      flush(ctx);
    },
    FEATURE
  );

  // ── BL-918 attention-signal-is-a-stall-01 / periodic-sample-is-not-a-
  //    stall-02 (both Outlines share this one Given step text) ──────────
  registry.defineScoped(
    /^a "([a-z_-]+)" telemetry row inside one ticket's window for a role$/,
    (ctx, rawEventType) => {
      const eventType = KNOWN_OUTLINE_EVENT_TYPES[rawEventType];
      if (!eventType) {
        throw new Error(`unrecognised Examples eventType: "${rawEventType}"`);
      }
      ctx.checkEventType = eventType;
      ctx.checkTicket = 'BL-9101';
      ctx.telemetryRows.push({ type: eventType, role: 'coder', at: isoOffset(10), count: 1 });
      flush(ctx);
    },
    FEATURE
  );

  // Shared When for scenarios 01, 02 and 03.
  registry.defineScoped(
    /^the ticket's lifecycle is composed$/,
    (ctx) => {
      ctx.events = composeAllLeanLedgerEvents(ctx.target, ctx.roles, ctx.checkTicket);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the ledger holds a stall entry of that event type for that ticket$/,
    (ctx) => {
      const found = ctx.events.some((e) => e.type === 'stall' && e.ticket === ctx.checkTicket && e.data.eventType === ctx.checkEventType);
      if (!found) {
        throw new Error(`expected a stall entry of type "${ctx.checkEventType}" for ${ctx.checkTicket}, got: ${JSON.stringify(ctx.events)}`);
      }
    },
    FEATURE
  );

  // Shared Then for scenarios 02 and 03 - a known sample and a genuinely
  // unrecognised type are excluded the same way.
  registry.defineScoped(
    /^the ledger holds no stall entry for that row$/,
    (ctx) => {
      const found = ctx.events.some((e) => e.type === 'stall' && e.data.eventType === ctx.checkEventType);
      if (found) {
        throw new Error(`expected no stall entry of type "${ctx.checkEventType}", got: ${JSON.stringify(ctx.events)}`);
      }
    },
    FEATURE
  );

  // ── BL-918 unrecognised-type-is-not-a-stall-03 ──────────────────────
  registry.defineScoped(
    /^a telemetry row whose type is recognised as neither an attention signal nor a known sample$/,
    (ctx) => {
      ctx.checkEventType = 'never-classified-type';
      ctx.checkTicket = 'BL-9101';
      ctx.telemetryRows.push({ type: ctx.checkEventType, role: 'coder', at: isoOffset(10), count: 1 });
      flush(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the unrecognised type is reported rather than silently dropped$/,
    (ctx) => {
      const reported = unrecognizedChaserTelemetryTypes(ctx.target);
      if (!reported.includes(ctx.checkEventType)) {
        throw new Error(`expected "${ctx.checkEventType}" to be reported as unrecognised, got: ${JSON.stringify(reported)}`);
      }
    },
    FEATURE
  );

  // ── BL-918 hypothesis-ranks-real-stalls-04 ──────────────────────────
  registry.defineScoped(
    /^a shift where one role has more periodic samples than any role has attention signals$/,
    (ctx) => {
      ctx.qaWt = mkTmp();
      writeHandoff(completedDir(ctx.qaWt), '00_a.handoff', {
        task: 'BL-9102-x',
        enqueued_at: WINDOW_START,
        dequeued_at: WINDOW_START,
        completed_at: WINDOW_END,
      });
      ctx.roles.push({ role: 'qa', worktreeName: 'qa', worktreePath: ctx.qaWt });
      // coder: 5 periodic samples total (1 from Background + 4 here), only
      // 1 real attention signal (the Background chase). qa: 0 samples, 2
      // real attention signals (nudge) - the most of any role.
      ctx.telemetryRows.push(
        { type: 'resource_sample', role: 'coder', at: isoOffset(11), count: null },
        { type: 'resource_sample', role: 'coder', at: isoOffset(12), count: null },
        { type: 'resource_sample', role: 'coder', at: isoOffset(13), count: null },
        { type: 'resource_sample', role: 'coder', at: isoOffset(14), count: null },
        { type: 'nudge', role: 'qa', at: isoOffset(5), count: 1 },
        { type: 'nudge', role: 'qa', at: isoOffset(6), count: 1 }
      );
      flush(ctx);
      ctx.multiTickets = ['BL-9101', 'BL-9102'];
    },
    FEATURE
  );

  registry.defineScoped(
    /^the coordinator builds the closing packet$/,
    (ctx) => {
      for (const ticket of ctx.multiTickets) {
        composeAndAppend(ctx, ticket);
      }
      ctx.packet = buildClosingCeremonyPacket(SHIFT_KEY, readLeanLedgerEvents(ctx.target));
    },
    FEATURE
  );

  registry.defineScoped(
    /^the packet's stall summary counts only attention signals$/,
    (ctx) => {
      if (ctx.packet.stalls.length === 0) {
        throw new Error('expected at least one stall in the packet (the fixture seeds real attention signals)');
      }
      const notAttention = ctx.packet.stalls.filter((s) => !CHASER_ATTENTION_SIGNAL_TYPES.includes(s.eventType));
      if (notAttention.length > 0) {
        throw new Error(`expected only attention-signal stalls in the packet, got: ${JSON.stringify(notAttention)}`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the stall-derived hypothesis names the role with the most attention signals$/,
    (ctx) => {
      const stallHypothesis = ctx.packet.hypotheses.find((h) => h.includes('chase pattern'));
      if (!stallHypothesis) {
        throw new Error(`expected a stall-derived hypothesis, got: ${JSON.stringify(ctx.packet.hypotheses)}`);
      }
      if (!stallHypothesis.includes(' qa ')) {
        throw new Error(`expected the hypothesis to name "qa" (2 real attention signals, more than coder's 1), got: "${stallHypothesis}"`);
      }
    },
    FEATURE
  );

  // ── BL-918 excluded-at-classification-05 ────────────────────────────
  registry.defineScoped(
    /^a consumer that reads the ledger's stall events$/,
    () => {
      // No-op marker: the Background already seeded a role/ticket/telemetry
      // mix. This scenario proves two independent readers of the resulting
      // ledger events - foldLeanLedgerSnapshot's foldStall and
      // closingCeremony's computeStalls, neither of which implements a
      // type filter of its own - never see a periodic-sample stall.
    },
    FEATURE
  );

  registry.defineScoped(
    /^it reports on a shift containing periodic samples$/,
    (ctx) => {
      composeAndAppend(ctx, 'BL-9101');
      ctx.snapshot = foldLeanLedgerSnapshot('BL-9101', readLeanLedgerEvents(ctx.target, 'BL-9101'));
      ctx.packet = buildClosingCeremonyPacket(SHIFT_KEY, readLeanLedgerEvents(ctx.target));
    },
    FEATURE
  );

  registry.defineScoped(
    /^it sees no periodic-sample stall entries without filtering them itself$/,
    (ctx) => {
      if (ctx.snapshot.stalls.length === 0) {
        throw new Error('expected at least one real stall (the fixture seeds a chase), so this check is not vacuously true');
      }
      const badSnapshot = ctx.snapshot.stalls.filter((s) => SAMPLE_TYPES.includes(s.eventType));
      if (badSnapshot.length > 0) {
        throw new Error(`foldLeanLedgerSnapshot saw a periodic-sample stall: ${JSON.stringify(badSnapshot)}`);
      }
      const badPacket = ctx.packet.stalls.filter((s) => SAMPLE_TYPES.includes(s.eventType));
      if (badPacket.length > 0) {
        throw new Error(`the closing packet saw a periodic-sample stall: ${JSON.stringify(badPacket)}`);
      }
    },
    FEATURE
  );
}

module.exports = { registerSteps };
