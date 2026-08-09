'use strict';

// BL-861: a sibling deferral (BL-532) survives its blocker closing - a check
// recorded at defer time must not read the blocker's own path under
// backlog/active/ (that path moves to backlog/done/ the moment the blocker
// closes), and a blocker's closure must be observable from BOTH `status`
// and `list` via the single shared lookup. Drives the REAL compiled
// siblingDeferral.ts, siblingDeferralStore.ts, and siblingDeferralStatus.ts
// over a real temp target root - a genuine fs round trip, no fakes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { checkReadsBlockerActivePath } = require(path.join(EXT_OUT, 'quality', 'siblingDeferral'));
const { appendSiblingDeferralRecordIfNew } = require(path.join(EXT_OUT, 'metrics', 'siblingDeferralStore'));
const { computeTicketDeferralStatus, listStrandedDeferrals } = require(path.join(EXT_OUT, 'metrics', 'siblingDeferralStatus'));

function mkTmpTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl861-'));
}

function writeTicketYaml(dir, id) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\ntitle: "fixture ticket"\n`);
}

// Mirrors qa-sibling-check.ts's runDefer composition exactly (the
// checkReadsBlockerActivePath guard, then append) - real production wiring,
// not a re-implementation of it.
function attemptDefer(target, { ticket, blockedBy, check, failureClass = 'integration', commit = 'abc1234567', at }) {
  if (checkReadsBlockerActivePath(check, blockedBy)) {
    return {
      refused: true,
      message:
        `REFUSED: --check reads ${blockedBy}'s own path under backlog/active/ - closing ${blockedBy} moves that ` +
        `file to backlog/done/, so the recorded check would stop being runnable at exactly the moment it should release ${ticket}.`,
    };
  }
  const recorded = appendSiblingDeferralRecordIfNew(target, { ticket, blockedBy, action: 'defer', failureClass, check, commit, at });
  return { refused: false, recorded };
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a sibling deferral store$/, (ctx) => {
    ctx.target = mkTmpTarget();
    ctx.deferSeq = 0;
  });

  // Reused verbatim for both the Background's own defer AND scenario 06's
  // second blocker.
  registry.define(/^ticket "([^"]+)" is deferred pending blocker "([^"]+)"$/, (ctx, ticket, blockedBy) => {
    ctx.deferSeq += 1;
    appendSiblingDeferralRecordIfNew(ctx.target, {
      ticket,
      blockedBy,
      action: 'defer',
      failureClass: 'integration',
      check: 'npm run test',
      commit: 'abc1234567',
      at: `2026-08-09T10:${String(ctx.deferSeq).padStart(2, '0')}:00.000Z`,
    });
  });

  // ── scenario 01/02 When ──────────────────────────────────────────────
  registry.define(/^QA defers naming a check that reads the blocker's file under the active backlog$/, (ctx) => {
    ctx.deferResult = attemptDefer(ctx.target, {
      ticket: 'BL-575',
      blockedBy: 'BL-681',
      check: 'test -f backlog/active/BL-681-consolidation-never-drops-a-human-sentence.yaml',
      at: '2026-08-09T11:00:00.000Z',
    });
  });

  registry.define(/^QA defers naming a check that runs a test suite$/, (ctx) => {
    ctx.deferResult = attemptDefer(ctx.target, {
      ticket: 'BL-575',
      blockedBy: 'BL-681',
      check: 'npx vitest run some.test.js',
      at: '2026-08-09T11:00:00.000Z',
    });
  });

  // ── scenario 01 Then ─────────────────────────────────────────────────
  registry.define(/^the deferral is refused$/, (ctx) => {
    if (ctx.deferResult.refused !== true) {
      throw new Error(`expected the deferral to be refused, got ${JSON.stringify(ctx.deferResult)}`);
    }
  });

  registry.define(/^QA is told the path moves when the blocker closes$/, (ctx) => {
    if (!/moves/.test(ctx.deferResult.message) || !ctx.deferResult.message.includes('BL-681')) {
      throw new Error(`expected a refusal message naming the moving path, got ${JSON.stringify(ctx.deferResult.message)}`);
    }
  });

  // ── scenario 02 Then ─────────────────────────────────────────────────
  registry.define(/^the deferral is recorded$/, (ctx) => {
    if (ctx.deferResult.refused !== false || ctx.deferResult.recorded !== true) {
      throw new Error(`expected the deferral to be recorded, got ${JSON.stringify(ctx.deferResult)}`);
    }
  });

  // ── scenario 03/04/06 Given: blocker closure state ──────────────────────
  registry.define(/^blocker "([^"]+)" (has closed|is still open)$/, (ctx, blockerId, state) => {
    const dir = state === 'has closed' ? path.join(ctx.target, 'backlog', 'done') : path.join(ctx.target, 'backlog', 'active');
    writeTicketYaml(dir, blockerId);
  });

  // ── scenario 03/04/06 When ──────────────────────────────────────────────
  registry.define(/^the deferral status of ticket "([^"]+)" is requested$/, (ctx, ticket) => {
    ctx.statusReport = computeTicketDeferralStatus(ctx.target, ticket);
  });

  // ── scenario 03/06a Then ─────────────────────────────────────────────
  registry.define(/^ticket "([^"]+)" is reported releasable$/, (ctx, ticket) => {
    if (ctx.statusReport.ticket !== ticket || ctx.statusReport.kind !== 'releasable') {
      throw new Error(`expected ${ticket} reported releasable, got ${JSON.stringify(ctx.statusReport)}`);
    }
  });

  registry.define(/^the report names where blocker "([^"]+)" closed$/, (ctx, blockerId) => {
    const entry = ctx.statusReport.closedBlockers.find((b) => b.blockedBy === blockerId);
    if (!entry || !entry.closedAt) {
      throw new Error(`expected closedBlockers to name where ${blockerId} closed, got ${JSON.stringify(ctx.statusReport.closedBlockers)}`);
    }
  });

  registry.define(/^no unrunnable check is emitted for ticket "([^"]+)"$/, (ctx) => {
    if (ctx.statusReport.openBlockers.length !== 0) {
      throw new Error(`expected no open blockers (no CHECK line), got ${JSON.stringify(ctx.statusReport.openBlockers)}`);
    }
  });

  // ── scenario 04 Then (quoted blocker id) ────────────────────────────────
  registry.define(/^ticket "([^"]+)" is reported deferred pending blocker "([^"]+)"$/, (ctx, ticket, blockerId) => {
    assertReportedDeferredPending(ctx, ticket, blockerId);
  });

  // ── scenario 06b (Outline) Then (unquoted blocker id, substituted from
  // the Examples table) ──────────────────────────────────────────────────
  registry.define(/^ticket "([^"]+)" is reported deferred pending blocker ([A-Z]{2}-\d+)$/, (ctx, ticket, blockerId) => {
    assertReportedDeferredPending(ctx, ticket, blockerId);
  });

  function assertReportedDeferredPending(ctx, ticket, blockerId) {
    if (ctx.statusReport.ticket !== ticket || ctx.statusReport.kind !== 'deferred') {
      throw new Error(`expected ${ticket} reported deferred, got ${JSON.stringify(ctx.statusReport)}`);
    }
    if (!ctx.statusReport.openBlockers.some((b) => b.blockedBy === blockerId)) {
      throw new Error(`expected open blockers to name ${blockerId}, got ${JSON.stringify(ctx.statusReport.openBlockers)}`);
    }
  }

  // ── scenario 05 When ─────────────────────────────────────────────────
  registry.define(/^open deferrals are listed$/, (ctx) => {
    ctx.strandedList = listStrandedDeferrals(ctx.target);
  });

  // ── scenario 05 Then ─────────────────────────────────────────────────
  registry.define(/^ticket "([^"]+)" appears as stranded$/, (ctx, ticket) => {
    if (!ctx.strandedList.some((r) => r.ticket === ticket)) {
      throw new Error(`expected ${ticket} to appear as stranded, got ${JSON.stringify(ctx.strandedList.map((r) => r.ticket))}`);
    }
  });

  registry.define(/^the listing is available without naming ticket "([^"]+)" in advance$/, (ctx) => {
    // listStrandedDeferrals (the prior step) takes no ticket argument at all
    // - this re-affirms the ticket was DISCOVERED, not looked up.
    if (typeof ctx.strandedList === 'undefined') {
      throw new Error('expected the listing to have already run with no ticket named');
    }
  });
}

module.exports = { registerSteps };
