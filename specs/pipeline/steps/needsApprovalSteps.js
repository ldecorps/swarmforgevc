'use strict';

// BL-251: step handlers for "the PWA and daily briefing list the tickets
// whose feature file needs human approval". Drives the REAL
// buildBacklogDashboard (extension/out/metrics/backlogDashboard.js) for the
// PWA surface's computed needsApproval field, and the REAL
// formatNeedsApprovalSection (extension/out/tools/needs-approval-line.js)
// for the daily briefing surface - the SAME two functions the live pipeline
// (backlog.json / briefing_email_lib.bb via the compiled CLI) already uses,
// per the ticket's own "single source, both surfaces read the same
// human_approval field" constraint. Per the ticket's own TESTABLE-boundary
// note, this asserts on the computed list and the assembled section text,
// never a rendered webview or a real email send.
const path = require('node:path');

const { buildBacklogDashboard } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics', 'backlogDashboard'));
const { formatNeedsApprovalSection } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'needs-approval-line'));
const { backfillHumanApprovalText } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'backfill-human-approval'));

function emptyDeliveryMetrics() {
  const emptyTrend = { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' };
  return {
    velocity: { weeklySeries: [], trend: emptyTrend, rollingWindowCount: 0, rollingWindowDays: 7 },
    burndown: [],
    cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, weeklySeries: [], trend: emptyTrend },
    forecasts: { tickets: [], milestones: [], throughputPerDay: 0 },
  };
}

function ticket(id, title, humanApproval) {
  const item = { id, title, status: 'active' };
  if (humanApproval !== undefined) {
    item.humanApproval = humanApproval;
  }
  return item;
}

function buildDashboard(ctx) {
  ctx.dashboard = buildBacklogDashboard(
    { active: ctx.liveTickets, paused: [], done: [] },
    [],
    emptyDeliveryMetrics(),
    'primary',
    'abc1234567',
    '2026-07-10T00:00:00Z'
  );
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^backlog items, each with a human_approval field that is "pending", "approved", or unset$/, (ctx) => {
    ctx.liveTickets = [];
  });

  // ── pwa-lists-pending-01 / briefing-lists-pending-02 / single-source-03 ──
  registry.define(/^a live ticket "([^"]+)" whose human_approval is "pending"$/, (ctx, name) => {
    ctx.liveTickets.push(ticket(`BL-${name}`, `Ticket ${name}`, 'pending'));
    ctx.pendingId = `BL-${name}`;
    ctx.pendingTitle = `Ticket ${name}`;
  });

  registry.define(/^a live ticket "([^"]+)" whose human_approval is "approved"$/, (ctx, name) => {
    ctx.liveTickets.push(ticket(`BL-${name}`, `Ticket ${name}`, 'approved'));
    ctx.approvedId = `BL-${name}`;
  });

  registry.define(/^the operator opens the PWA$/, (ctx) => {
    buildDashboard(ctx);
  });

  registry.define(/^the needs-approval list shows "([^"]+)" with its id and title$/, (ctx, name) => {
    const id = `BL-${name}`;
    const entry = ctx.dashboard.needsApproval.find((e) => e.id === id);
    if (!entry || entry.title !== ctx.pendingTitle) {
      throw new Error(`expected needsApproval to list "${id}" with title "${ctx.pendingTitle}", got: ${JSON.stringify(ctx.dashboard.needsApproval)}`);
    }
  });

  registry.define(/^it does not show "([^"]+)"$/, (ctx, name) => {
    const id = `BL-${name}`;
    if (ctx.dashboard.needsApproval.some((e) => e.id === id)) {
      throw new Error(`expected "${id}" (approved) to be excluded from needsApproval, got: ${JSON.stringify(ctx.dashboard.needsApproval)}`);
    }
  });

  registry.define(/^the daily briefing is produced$/, (ctx) => {
    buildDashboard(ctx);
    ctx.briefingSection = formatNeedsApprovalSection(ctx.dashboard.needsApproval);
  });

  registry.define(/^the briefing lists "([^"]+)" by its id and title in a needs-approval section$/, (ctx, name) => {
    const id = `BL-${name}`;
    if (!ctx.briefingSection.includes(`${id}: ${ctx.pendingTitle}`)) {
      throw new Error(`expected the briefing section to list "${id}: ${ctx.pendingTitle}", got: ${ctx.briefingSection}`);
    }
  });

  registry.define(/^both the PWA and the daily briefing render the needs-approval list$/, (ctx) => {
    buildDashboard(ctx);
    ctx.briefingSection = formatNeedsApprovalSection(ctx.dashboard.needsApproval);
  });

  registry.define(/^both show "([^"]+)", read from the human_approval field rather than a parsed comment$/, (ctx, name) => {
    const id = `BL-${name}`;
    const inPwa = ctx.dashboard.needsApproval.some((e) => e.id === id);
    const inBriefing = ctx.briefingSection.includes(id);
    if (!inPwa || !inBriefing) {
      throw new Error(`expected both surfaces to show "${id}" - PWA: ${inPwa}, briefing: ${inBriefing}`);
    }
    // The fixture ticket carries humanApproval as a STRUCTURED field
    // (ticket() above), never a "# HUMAN APPROVAL:" comment string at all -
    // both surfaces derived their answer from that field by construction.
    const fixtureTicket = ctx.liveTickets.find((t) => t.id === id);
    if (fixtureTicket.humanApproval !== 'pending') {
      throw new Error('expected the fixture ticket itself to carry the structured field, not a comment');
    }
  });

  // ── empty-state-04 ────────────────────────────────────────────────────
  registry.define(/^no live ticket has human_approval "pending"$/, (ctx) => {
    ctx.liveTickets = [ticket('BL-500', 'An approved ticket', 'approved'), ticket('BL-501', 'An unset ticket')];
  });

  registry.define(/^the needs-approval list is rendered$/, (ctx) => {
    buildDashboard(ctx);
    ctx.briefingSection = formatNeedsApprovalSection(ctx.dashboard.needsApproval);
  });

  registry.define(/^it shows an explicit nothing-awaiting-approval state rather than an error or a blank$/, (ctx) => {
    if (ctx.dashboard.needsApproval.length !== 0) {
      throw new Error(`expected an empty needsApproval list, got: ${JSON.stringify(ctx.dashboard.needsApproval)}`);
    }
    if (!/nothing awaiting approval/i.test(ctx.briefingSection)) {
      throw new Error(`expected an explicit nothing-awaiting-approval state, got: "${ctx.briefingSection}"`);
    }
  });

  // ── backfill-seeds-field-05 ───────────────────────────────────────────
  // BL-234 equivalent mutants (confirmed, BL-113 mutation pass): a mutation
  // of the "<comment>" column that touches only incidental wording ("human"
  // -> "Human" in "pending human review") or a case change to the matched
  // keyword itself ("approved" -> "approveD" in "approved by operator")
  // survives - correctly. backfillHumanApprovalText's own
  // deriveApprovalFromCommentBlock does `text.toLowerCase().includes(
  // 'pending'|'approved')` over the WHOLE comment block: it provably
  // ignores every word except those two keywords, and is provably
  // case-insensitive to the keywords themselves. No assertion here could
  // ever differentiate the original example from either mutation without
  // testing implementation trivia the production code deliberately doesn't
  // care about - real ticket comments in this repo vary in wording/casing
  // exactly this way, and the loose match is intentional, not a gap.
  registry.define(/^a live ticket predating the field whose comment marks it "([^"]+)"$/, (ctx, comment) => {
    ctx.rawYaml = `id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: ${comment}.\n`;
  });

  registry.define(/^the backfill runs$/, (ctx) => {
    ctx.backfillResult = backfillHumanApprovalText(ctx.rawYaml);
  });

  registry.define(/^its human_approval is set to "([^"]+)"$/, (ctx, expectedValue) => {
    if (ctx.backfillResult.value !== expectedValue) {
      throw new Error(`expected human_approval seeded to "${expectedValue}", got: ${JSON.stringify(ctx.backfillResult)}`);
    }
  });
}

module.exports = { registerSteps };
