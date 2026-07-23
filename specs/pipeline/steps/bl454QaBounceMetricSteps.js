'use strict';

// BL-454: step handlers for the QA-bounce structured attribution metric.
// Scenarios 01/02 drive the REAL compiled appendQaBounceRecordIfNew/
// readQaBounceRecords against a real temp target root - a genuine fs round
// trip, no fakes. Scenarios 03/04 drive the REAL compiled
// backfillQaBounces over a small fixture evidence corpus + backlog tickets.
// Scenarios 05/06 drive the REAL compiled computeQaBounceTally directly - a
// pure function, no adapters needed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { isKnownProducingRole, isKnownTicketType, isKnownFailureClass, computeQaBounceTally } = require(
  path.join(EXT_OUT, 'quality', 'qaBounce')
);
const { appendQaBounceRecordIfNew, readQaBounceRecords } = require(path.join(EXT_OUT, 'metrics', 'qaBounceStore'));
const { backfillQaBounces } = require(path.join(EXT_OUT, 'tools', 'backfill-qa-bounces'));

function mkTmpTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-qa-bounce-'));
}

function writeEvidence(root, filename, content) {
  const dir = path.join(root, 'backlog', 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
}

function writeBacklogTicket(root, folder, id, type) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: Fixture ticket\ntype: ${type}\n`);
}

function fixtureRecord(overrides) {
  return {
    ticket: 'BL-340',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-14T10:00:00.000Z',
    ...overrides,
  };
}

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup (here,
// the real closed-set predicates the production code itself validates
// against - not a second, drift-prone copy), never a bare passthrough.
function assertKnownRole(where, role) {
  if (!isKnownProducingRole(role)) {
    throw new Error(`${where}: unrecognized <role> example value "${role}"`);
  }
}
function assertKnownType(where, type) {
  if (!isKnownTicketType(type)) {
    throw new Error(`${where}: unrecognized <type> example value "${type}"`);
  }
}
function assertKnownClass(where, cls) {
  if (!isKnownFailureClass(cls)) {
    throw new Error(`${where}: unrecognized <class> example value "${cls}"`);
  }
}

function registerSteps(registry) {
  // ── qa-bounce-01 (Scenario Outline) ─────────────────────────────────────
  registry.define(
    /^a QA bounce of ticket "([^"]*)" produced by the "([^"]*)" of type "([^"]*)" with failure class "([^"]*)"$/,
    (ctx, id, role, type, cls) => {
      assertKnownRole('qa-bounce-01', role);
      assertKnownType('qa-bounce-01', type);
      assertKnownClass('qa-bounce-01', cls);
      ctx.target = mkTmpTarget();
      ctx.record = fixtureRecord({ ticket: id, producingRole: role, ticketType: type, failureClass: cls });
    }
  );

  registry.define(/^the bounce is recorded$/, (ctx) => {
    ctx.recorded = appendQaBounceRecordIfNew(ctx.target, ctx.record);
  });

  registry.define(
    /^the bounce log has one entry for "([^"]*)" attributed to the "([^"]*)" of type "([^"]*)" with class "([^"]*)"$/,
    (ctx, id, role, type, cls) => {
      assertKnownRole('qa-bounce-01', role);
      assertKnownType('qa-bounce-01', type);
      assertKnownClass('qa-bounce-01', cls);
      const records = readQaBounceRecords(ctx.target).filter((r) => r.ticket === id);
      if (records.length !== 1) {
        throw new Error(`expected exactly one bounce entry for ${id}, got ${records.length}`);
      }
      const [record] = records;
      if (record.producingRole !== role || record.ticketType !== type || record.failureClass !== cls) {
        throw new Error(`expected ${id} attributed to ${role}/${type}/${cls}, got ${JSON.stringify(record)}`);
      }
    }
  );

  // ── qa-bounce-02 ──────────────────────────────────────────────────────
  registry.define(/^a bounce for ticket "([^"]*)" has already been recorded$/, (ctx, id) => {
    ctx.target = mkTmpTarget();
    ctx.record = fixtureRecord({ ticket: id });
    appendQaBounceRecordIfNew(ctx.target, ctx.record);
  });

  registry.define(/^the same bounce is recorded again$/, (ctx) => {
    ctx.recordedAgain = appendQaBounceRecordIfNew(ctx.target, { ...ctx.record, commit: 'deadbeef00' });
  });

  registry.define(/^the bounce log still has exactly one entry for "([^"]*)"$/, (ctx, id) => {
    const records = readQaBounceRecords(ctx.target).filter((r) => r.ticket === id);
    if (records.length !== 1) {
      throw new Error(`expected exactly one bounce entry for ${id} after a duplicate recording, got ${records.length}`);
    }
  });

  // ── qa-bounce-03/04 ───────────────────────────────────────────────────
  registry.define(/^an evidence corpus containing several bounce files$/, (ctx) => {
    ctx.target = mkTmpTarget();
    writeBacklogTicket(ctx.target, 'done', 'BL-259', 'defect');
    writeBacklogTicket(ctx.target, 'active', 'BL-414', 'feature');
    writeEvidence(
      ctx.target,
      'BL-259-gated-dependency-rule-checker-bounce-20260710-hardener.md',
      ['# BL-259 hardener bounce', '', '## Failure class', '', '`behavior`'].join('\n')
    );
    writeEvidence(
      ctx.target,
      'BL-414-title-age-first-tick-rate-limit-bounce-20260715.md',
      ['# BL-414 hardener bounce — 20260715', '', '## Verdict: BOUNCE to coder', '', '4. **Failure class**: `behavior`.'].join('\n')
    );
  });

  registry.define(/^the one-time backfill runs$/, (ctx) => {
    ctx.backfillResult = backfillQaBounces(ctx.target);
  });

  registry.define(/^each bounce file becomes one recorded bounce attributed to its producing role and ticket type$/, (ctx) => {
    const records = readQaBounceRecords(ctx.target);
    if (records.length !== 2) {
      throw new Error(`expected 2 recorded bounces from the fixture corpus, got ${records.length}: ${JSON.stringify(records)}`);
    }
    const byTicket = Object.fromEntries(records.map((r) => [r.ticket, r]));
    // A hardener-authored bounce (filename suffix) attributes to the
    // architect, the pipeline stage immediately before the reporter - see
    // qaBounceEvidenceParser.ts's PRODUCING_ROLE_BEFORE_REPORTER.
    if (byTicket['BL-259'].producingRole !== 'architect' || byTicket['BL-259'].ticketType !== 'defect') {
      throw new Error(`unexpected attribution for BL-259: ${JSON.stringify(byTicket['BL-259'])}`);
    }
    if (byTicket['BL-414'].producingRole !== 'coder' || byTicket['BL-414'].ticketType !== 'feature') {
      throw new Error(`unexpected attribution for BL-414: ${JSON.stringify(byTicket['BL-414'])}`);
    }
  });

  registry.define(/^running the backfill again adds no further entries$/, (ctx) => {
    const second = backfillQaBounces(ctx.target);
    if (second.recorded !== 0) {
      throw new Error(`expected re-running the backfill to record 0 new entries, got ${second.recorded}`);
    }
    if (readQaBounceRecords(ctx.target).length !== 2) {
      throw new Error('expected the bounce log to still have exactly 2 entries after a re-run');
    }
  });

  registry.define(/^an evidence file that records a non-bounce outcome$/, (ctx) => {
    ctx.target = mkTmpTarget();
    writeEvidence(ctx.target, 'BL-368-already-shipped-20260716.md', '# BL-368 already shipped\n\nAlready delivered by BL-367.\n');
  });

  registry.define(/^that file produces no bounce entry$/, (ctx) => {
    if (ctx.backfillResult.recorded !== 0) {
      throw new Error(`expected the non-bounce file to yield 0 recorded bounces, got ${ctx.backfillResult.recorded}`);
    }
    if (readQaBounceRecords(ctx.target).length !== 0) {
      throw new Error('expected no bounce log entries for a non-bounce evidence file');
    }
  });

  // ── qa-bounce-05/06 (pure aggregator) ─────────────────────────────────
  registry.define(/^recorded bounces attributed across several roles$/, (ctx) => {
    ctx.records = [
      fixtureRecord({ ticket: 'BL-1', producingRole: 'coder', ticketType: 'feature', at: '2026-07-01T00:00:00.000Z' }),
      fixtureRecord({ ticket: 'BL-2', producingRole: 'coder', ticketType: 'bug', failureClass: 'unit', at: '2026-07-02T00:00:00.000Z' }),
      fixtureRecord({ ticket: 'BL-3', producingRole: 'architect', ticketType: 'feature', at: '2026-07-03T00:00:00.000Z' }),
    ];
  });

  registry.define(/^the QA-bounce tally is computed$/, (ctx) => {
    ctx.tally = computeQaBounceTally(ctx.records);
  });

  registry.define(/^the roles are ranked by bounce count with the most-bouncing role first$/, (ctx) => {
    const top = ctx.tally.byRole[0];
    if (!top || top.role !== 'coder' || top.count !== 2) {
      throw new Error(`expected coder to rank first with count 2, got ${JSON.stringify(ctx.tally.byRole)}`);
    }
  });

  registry.define(/^recorded bounces attributed across several ticket types$/, (ctx) => {
    ctx.records = [
      fixtureRecord({ ticket: 'BL-1', producingRole: 'coder', ticketType: 'bug', failureClass: 'unit', at: '2026-07-01T00:00:00.000Z' }),
      fixtureRecord({ ticket: 'BL-2', producingRole: 'cleaner', ticketType: 'bug', failureClass: 'compile', at: '2026-07-02T00:00:00.000Z' }),
      fixtureRecord({ ticket: 'BL-3', producingRole: 'architect', ticketType: 'feature', at: '2026-07-03T00:00:00.000Z' }),
    ];
  });

  registry.define(/^each ticket type shows its own bounce count$/, (ctx) => {
    if (ctx.tally.byTicketType.bug !== 2 || ctx.tally.byTicketType.feature !== 1) {
      throw new Error(`expected {bug:2, feature:1}, got ${JSON.stringify(ctx.tally.byTicketType)}`);
    }
  });
}

module.exports = { registerSteps };
