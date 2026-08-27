'use strict';

// BL-430: step handlers for "the swarm can observe its own rework rate".
// Scenarios 01-04 drive the REAL compiled computeReworkSignal
// (extension/out/metrics/reworkObservatory.js) over fixture
// CompletedTicketRecord[]. Scenario 05 (BL-340: read from main, not the
// worktree) drives the REAL compiled loadCompletedTicketRecords against a
// real, disposable git fixture repo - the same shape as
// reworkObservatorySource.test.js's own "read from main" unit test, proven
// here at the acceptance level too.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REWORK_MODULE = path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics', 'reworkObservatory.js');
const SOURCE_MODULE = path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics', 'reworkObservatorySource.js');

const WINDOW_START = Date.parse('2026-07-08T00:00:00Z');
const WINDOW_END = Date.parse('2026-07-15T00:00:00Z');
const BASELINE_START = Date.parse('2026-07-01T00:00:00Z');

function record(overrides = {}) {
  return {
    ticketId: 'BL-1',
    completedAtMs: Date.parse('2026-07-10T00:00:00Z'),
    bounced: false,
    bouncedFromRole: null,
    ticketClass: null,
    ...overrides,
  };
}

function defaultWindowRecords() {
  return [
    // Current window (2026-07-08..15): 1 of 4 bounced -> rate 0.25.
    record({ ticketId: 'BL-1', bounced: true, bouncedFromRole: 'architect', ticketClass: 'high' }),
    record({ ticketId: 'BL-2', bounced: false }),
    record({ ticketId: 'BL-3', bounced: false }),
    record({ ticketId: 'BL-4', bounced: false }),
    // Trailing baseline period (2026-07-01..08): 1 of 2 bounced -> rate 0.5,
    // so rework-observatory-03's "a numeric baseline is reported" has a
    // real sample to compute against, not just this window's own tickets.
    record({ ticketId: 'BL-b1', bounced: true, completedAtMs: Date.parse('2026-07-03T00:00:00Z') }),
    record({ ticketId: 'BL-b2', bounced: false, completedAtMs: Date.parse('2026-07-05T00:00:00Z') }),
  ];
}

function git(cwd, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a window of completed pipeline work with recorded QA bounces$/, (ctx) => {
    ctx.records = defaultWindowRecords();
    ctx.windowStartMs = WINDOW_START;
    ctx.windowEndMs = WINDOW_END;
    ctx.baselineStartMs = BASELINE_START;
  });

  // ── rework-observatory-01 ────────────────────────────────────────────────
  registry.define(/^the observatory computes the rework signal$/, (ctx) => {
    const { computeReworkSignal } = require(REWORK_MODULE);
    const records = ctx.realGitRepo
      ? require(SOURCE_MODULE).loadCompletedTicketRecords(ctx.realGitRepo, [])
      : ctx.records;
    ctx.signal = computeReworkSignal(records, ctx.windowStartMs, ctx.windowEndMs, ctx.baselineStartMs);
  });

  registry.define(/^it reports the share of tickets that were bounced at least once over the window$/, (ctx) => {
    if (ctx.signal.reworkRate !== 0.25) {
      throw new Error(`expected a rework rate of 0.25 (1 of 4 bounced), got ${JSON.stringify(ctx.signal)}`);
    }
  });

  // ── rework-observatory-02 (Scenario Outline: role / ticket-class) ───────
  registry.define(/^the bounces in the window concentrate on one (role|ticket-class)$/, (ctx, dimension) => {
    if (dimension === 'role') {
      ctx.records = [
        record({ ticketId: 'BL-1', bounced: true, bouncedFromRole: 'architect' }),
        record({ ticketId: 'BL-2', bounced: true, bouncedFromRole: 'architect' }),
        record({ ticketId: 'BL-3', bounced: true, bouncedFromRole: 'QA' }),
      ];
      ctx.expectedConcentration = 'architect';
    } else if (dimension === 'ticket-class') {
      ctx.records = [
        record({ ticketId: 'BL-1', bounced: true, ticketClass: 'high' }),
        record({ ticketId: 'BL-2', bounced: true, ticketClass: 'high' }),
        record({ ticketId: 'BL-3', bounced: true, ticketClass: 'low' }),
      ];
      ctx.expectedConcentration = 'high';
    } else {
      throw new Error(`unknown dimension example value: ${dimension}`);
    }
    ctx.dimension = dimension;
  });

  registry.define(/^it names that (role|ticket-class) as where rework concentrates$/, (ctx, dimension) => {
    const actual = dimension === 'role' ? ctx.signal.topRole : ctx.signal.topTicketClass;
    if (actual !== ctx.expectedConcentration) {
      throw new Error(`expected ${dimension} concentration "${ctx.expectedConcentration}", got "${actual}"`);
    }
  });

  // ── rework-observatory-03 ────────────────────────────────────────────────
  registry.define(/^it reports a trailing baseline rate against which the current rate can be compared$/, (ctx) => {
    if (typeof ctx.signal.baselineRate !== 'number') {
      throw new Error(`expected a numeric baseline rate, got ${JSON.stringify(ctx.signal.baselineRate)}`);
    }
  });

  // ── rework-observatory-04 ────────────────────────────────────────────────
  registry.define(/^a window containing no completed tickets$/, (ctx) => {
    ctx.records = [];
  });

  registry.define(/^it reports no sample$/, (ctx) => {
    if (ctx.signal.hasSample !== false) {
      throw new Error(`expected hasSample=false, got ${JSON.stringify(ctx.signal)}`);
    }
  });

  registry.define(/^it does not report a rework rate of zero or a rework rate of one hundred percent$/, (ctx) => {
    if (ctx.signal.reworkRate === 0 || ctx.signal.reworkRate === 1) {
      throw new Error(`expected a null (no-sample) rate, got a fabricated ${ctx.signal.reworkRate}`);
    }
    if (ctx.signal.reworkRate !== null) {
      throw new Error(`expected reworkRate to be null on no-sample, got ${ctx.signal.reworkRate}`);
    }
  });

  // ── rework-observatory-05 (BL-340: read from main, not the worktree) ────
  registry.define(/^a QA bounce recorded only as committed evidence on the main ref$/, (ctx) => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-rework-observatory-'));
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 't@t']);
    git(repo, ['config', 'user.name', 't']);
    git(repo, ['checkout', '-q', '-b', 'main']);

    mkdirp(path.join(repo, 'backlog', 'active'));
    fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-900.yaml'), 'id: BL-900\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'promote'], '2026-07-10T08:00:00');

    mkdirp(path.join(repo, 'backlog', 'done'));
    git(repo, ['mv', 'backlog/active/BL-900.yaml', 'backlog/done/BL-900.yaml']);
    git(repo, ['commit', '-q', '-m', 'close'], '2026-07-10T09:00:00');

    mkdirp(path.join(repo, 'backlog', 'evidence'));
    fs.writeFileSync(path.join(repo, 'backlog', 'evidence', 'BL-900-bounce-20260710.md'), '# BL-900 QA bounce\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'BL-900 QA bounce evidence'], '2026-07-10T10:00:00');

    ctx.realGitRepo = repo;
    ctx.windowStartMs = Date.parse('2026-07-08T00:00:00Z');
    ctx.windowEndMs = Date.parse('2026-07-15T00:00:00Z');
    ctx.baselineStartMs = Date.parse('2026-07-01T00:00:00Z');
  });

  registry.define(/^that evidence file is absent from the current worktree checkout$/, (ctx) => {
    // Roll the CURRENT checkout back to before the evidence commit - a
    // plain filesystem read here finds nothing, exactly the undercount
    // BL-340 exists to prevent. loadCompletedTicketRecords must still read
    // it from the 'main' ref, not this checkout.
    git(ctx.realGitRepo, ['checkout', '-q', '-b', 'stale-worktree', 'HEAD~1']);
    if (fs.existsSync(path.join(ctx.realGitRepo, 'backlog', 'evidence', 'BL-900-bounce-20260710.md'))) {
      throw new Error('test setup bug: evidence file unexpectedly present in the worktree checkout');
    }
  });

  registry.define(/^that bounce is counted in the rework rate$/, (ctx) => {
    if (ctx.signal.reworkRate !== 1) {
      throw new Error(`expected the single completed ticket's bounce to be counted (rate 1), got ${JSON.stringify(ctx.signal)}`);
    }
  });
}

module.exports = { registerSteps };
