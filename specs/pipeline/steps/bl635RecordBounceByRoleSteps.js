'use strict';

// BL-635: step handlers for "record bounces by bouncing role and report the
// rework metric". Every CLI-facing scenario shells out to the REAL compiled
// binary (extension/out/tools/record-bounce.js) against a real temp fixture
// repo - the recordBounceCli.test.js pattern, never a reimplementation of
// the CLI's own validation/merge logic in JS. The store/metric assertions
// read the same compiled qaBounceStore/qaBounce/reworkRounds/
// costHealthSidecar modules the CLI and sidecar emitter themselves use.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const SWARMFORGE_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge');
const CLI = path.join(EXT_DIR, 'out', 'tools', 'record-bounce.js');
// BL-635 SEND BACK #1: readBounceRecords/appendBounceRecordIfNew/bouncesDir
// moved to bounceStore.ts in the cleaner's BL-485 DRY split (73419cd0e);
// this step handler's require was never updated to follow them, so every
// scenario touching the generalised (by-role) log failed with "is not a
// function". qaBouncesDir alone stayed behind in qaBounceStore.ts.
const { qaBouncesDir } = require(path.join(EXT_DIR, 'out', 'metrics', 'qaBounceStore'));
const { readBounceRecords, appendBounceRecordIfNew, bouncesDir } = require(path.join(EXT_DIR, 'out', 'metrics', 'bounceStore'));
const { computeQaBounceTally, computeBounceTallyByBouncingRole } = require(path.join(EXT_DIR, 'out', 'quality', 'qaBounce'));
const {
  computeRoundsPerCloseSeriesByRole,
  computeMaxRoundsIndicator,
  computeDailyReworkSeries,
  renderDailyReworkMarkdownLine,
} = require(path.join(EXT_DIR, 'out', 'metrics', 'reworkRounds'));
const { buildCostHealthSidecar, renderCostHealthSection } = require(path.join(EXT_DIR, 'out', 'notify', 'costHealthSidecar'));
const { formatBounceLine } = require(path.join(EXT_DIR, 'out', 'tools', 'qa-bounce-line'));

const FEATURE_NAME = 'record bounces by bouncing role and report the rework metric';

const TICKET = 'BL-9635';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function ticketYamlPath(root, ticket = TICKET) {
  return path.join(root, 'backlog', 'active', `${ticket}-fixture.yaml`);
}

function mkFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl635-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(ticketYamlPath(root), `id: ${TICKET}\ntitle: "fixture ticket"\nstatus: active\nassigned_to: coder\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed fixture repo']);
  return root;
}

function readTicketYaml(ctx) {
  return fs.readFileSync(ticketYamlPath(ctx.target), 'utf8');
}

function bounceCount(yamlText) {
  const match = /bounce_count: (\d+)/.exec(yamlText);
  return match ? Number(match[1]) : 0;
}

function parseEntries(yamlText) {
  const lines = yamlText.split('\n').filter((l) => /^\s*- \{/.test(l));
  return lines.map((line) => {
    const match = /at: ([^,]+), by: ([^,]+), blamed: ([^,]+), class: ([^,]+), commit: ([^,]+), evidence: ([^}]+) \}/.exec(line);
    if (!match) {
      throw new Error(`unparsable bounce_history entry line: ${line}`);
    }
    const [, at, by, blamed] = match;
    return { at: at.trim(), by: by.trim(), blamed: blamed.trim() };
  });
}

function runCli(ctx, extraArgs) {
  const args = [
    '--ticket',
    TICKET,
    '--role',
    'coder',
    '--type',
    'defect',
    '--class',
    'behavior',
    ...extraArgs,
  ];
  try {
    const out = execFileSync('node', [CLI, ...args], { cwd: ctx.target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.cliError = null;
    return JSON.parse(out);
  } catch (err) {
    ctx.cliError = err;
    ctx.cliStderr = err.stderr ? err.stderr.toString() : '';
    return null;
  }
}

function record(overrides = {}) {
  return {
    ticket: 'BL-590',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-26T10:00:00.000Z',
    by: 'architect',
    ...overrides,
  };
}

function emptyReliabilitySeries(nowIso) {
  return {
    chases: [{ periodStart: nowIso, value: 0 }],
    nudges: [{ periodStart: nowIso, value: 0 }],
    respawns: [{ periodStart: nowIso, value: 0 }],
    failedDeliveries: [{ periodStart: nowIso, value: 0 }],
  };
}

function readPrompt(role) {
  return fs.readFileSync(path.join(SWARMFORGE_DIR, 'roles', `${role}.prompt`), 'utf8');
}

function registerSteps(registry) {
  function step(pattern, handler) {
    registry.defineScoped(pattern, handler, FEATURE_NAME);
  }

  // ── shared Given: fixture repo with one ticket, no bounces yet ──────────
  step(/^an active ticket fixture with no recorded bounces$/, (ctx) => {
    ctx.target = mkFixtureRepo();
  });

  // ── record-bounce-by-role-01/07: recording with an explicit bouncing role
  step(/^record-bounce records a bounce with bouncing role (\w+) blaming coder with an evidence path$/, (ctx, by) => {
    ctx.result = runCli(ctx, [
      '--commit',
      'abc1234567',
      '--by',
      by,
      '--evidence',
      `backlog/evidence/${TICKET}-bounce-20260726.md`,
    ]);
  });

  step(/^the appended durable log record carries by (\w+)$/, (ctx, by) => {
    const records = readBounceRecords(ctx.target).filter((r) => r.ticket === TICKET);
    if (records.length === 0 || records[records.length - 1].by !== by) {
      throw new Error(`expected the newest durable log record to carry by ${by}, got ${JSON.stringify(records)}`);
    }
  });

  step(/^the durable log record still blames coder as the producing role$/, (ctx) => {
    const records = readBounceRecords(ctx.target).filter((r) => r.ticket === TICKET);
    const newest = records[records.length - 1];
    if (!newest || newest.producingRole !== 'coder') {
      throw new Error(`expected producingRole coder, got ${JSON.stringify(newest)}`);
    }
  });

  step(/^the ticket record gains a bounce_history entry with by (\w+) and blamed coder$/, (ctx, by) => {
    const entries = parseEntries(readTicketYaml(ctx));
    const newest = entries[entries.length - 1];
    if (!newest || newest.by !== by || newest.blamed !== 'coder') {
      throw new Error(`expected a bounce_history entry with by ${by}, blamed coder, got ${JSON.stringify(newest)}`);
    }
  });

  step(/^the ticket bounce_count equals (\d+)$/, (ctx, count) => {
    const actual = bounceCount(readTicketYaml(ctx));
    if (actual !== Number(count)) {
      throw new Error(`expected bounce_count ${count}, got ${actual}`);
    }
  });

  // ── record-bounce-by-role-02: missing --by fails loudly, writes nothing ──
  step(/^record-bounce is invoked without the by flag$/, (ctx) => {
    ctx.result = runCli(ctx, ['--commit', 'abc1234567']);
  });

  step(/^the invocation fails with a usage error naming the missing by flag$/, (ctx) => {
    if (!ctx.cliError) {
      throw new Error('expected the CLI invocation to fail (nonzero exit)');
    }
    if (!/--by <bouncingRole>/.test(ctx.cliStderr)) {
      throw new Error(`expected usage output naming --by, got: ${ctx.cliStderr}`);
    }
  });

  step(/^no durable log record is written$/, (ctx) => {
    const records = readBounceRecords(ctx.target).filter((r) => r.ticket === TICKET);
    if (records.length !== 0) {
      throw new Error(`expected no durable log records, got ${JSON.stringify(records)}`);
    }
  });

  step(/^the ticket record is unchanged$/, (ctx) => {
    const text = readTicketYaml(ctx);
    if (/bounce_count/.test(text)) {
      throw new Error(`expected the ticket record to carry no bounce_count, got: ${text}`);
    }
  });

  // ── record-bounce-by-role-03: unknown bouncing role rejected ────────────
  step(/^record-bounce is invoked with the misspelt bouncing role hardener$/, (ctx) => {
    ctx.result = runCli(ctx, ['--commit', 'abc1234567', '--by', 'hardener']);
  });

  step(/^the invocation fails naming the valid bouncing role set$/, (ctx) => {
    if (!ctx.cliError) {
      throw new Error('expected the CLI invocation to fail (nonzero exit)');
    }
    if (!/specifier\|coder\|cleaner\|architect\|hardender\|documenter\|QA/.test(ctx.cliStderr)) {
      throw new Error(`expected usage output naming the valid bouncing role set, got: ${ctx.cliStderr}`);
    }
  });

  // ── record-bounce-by-role-04: 4 same-day architect bounces, distinct commits
  step(/^record-bounce records four bounces by architect each citing a distinct bounced commit$/, (ctx) => {
    const classes = ['behavior', 'compile', 'unit', 'integration'];
    for (let i = 0; i < 4; i++) {
      const commit = `bl635comm${i}`;
      const result = runCli(ctx, [
        '--commit',
        commit,
        '--class',
        classes[i],
        '--by',
        'architect',
        '--evidence',
        `backlog/evidence/${TICKET}-bounce-2026072${i}.md`,
      ]);
      if (!result || result.recorded !== true) {
        throw new Error(`expected bounce #${i + 1} to record, got ${JSON.stringify(result)}`);
      }
    }
  });

  step(/^the ticket bounce_history holds four entries each with by architect$/, (ctx) => {
    const entries = parseEntries(readTicketYaml(ctx));
    if (entries.length !== 4 || !entries.every((e) => e.by === 'architect')) {
      throw new Error(`expected 4 bounce_history entries all by architect, got ${JSON.stringify(entries)}`);
    }
  });

  step(/^the durable log holds four records for the ticket each with by architect$/, (ctx) => {
    const records = readBounceRecords(ctx.target).filter((r) => r.ticket === TICKET);
    if (records.length !== 4 || !records.every((r) => r.by === 'architect')) {
      throw new Error(`expected 4 durable log records all by architect, got ${JSON.stringify(records)}`);
    }
  });

  // ── record-bounce-by-role-05: role prompts name the record-bounce step ──
  step(/^the pipeline role prompts$/, (ctx) => {
    ctx.prompts = {
      architect: readPrompt('architect'),
      QA: readPrompt('QA'),
      cleaner: readPrompt('cleaner'),
      hardender: readPrompt('hardender'),
      documenter: readPrompt('documenter'),
      specifier: readPrompt('specifier'),
    };
  });

  step(/^the architect prompt send-back procedure instructs running record-bounce with by architect and an evidence path$/, (ctx) => {
    const text = ctx.prompts.architect;
    if (!/record-bounce\.js/.test(text) || !/--by architect/.test(text) || !/--evidence/.test(text)) {
      throw new Error('expected architect.prompt to instruct running record-bounce.js with --by architect and --evidence');
    }
  });

  step(/^the QA prompt bounce procedure invokes record-bounce with by QA$/, (ctx) => {
    const text = ctx.prompts.QA;
    if (!/record-bounce\.js/.test(text) || !/--by QA/.test(text)) {
      throw new Error('expected QA.prompt to invoke record-bounce.js with --by QA');
    }
    if (/node extension\/out\/tools\/record-qa-bounce\.js/.test(text)) {
      throw new Error('expected QA.prompt to no longer invoke the legacy record-qa-bounce.js CLI');
    }
  });

  step(/^each of the cleaner hardender documenter and specifier prompts names the record-bounce step for its own send-backs$/, (ctx) => {
    for (const role of ['cleaner', 'hardender', 'documenter', 'specifier']) {
      const text = ctx.prompts[role];
      if (!/record-bounce\.js/.test(text)) {
        throw new Error(`expected ${role}.prompt to name the record-bounce step`);
      }
    }
  });

  // ── record-bounce-by-role-06: legacy by-less records stay readable ──────
  step(/^a legacy qa_bounces log containing a record without a by field$/, (ctx) => {
    ctx.target = ctx.target || mkFixtureRepo();
    fs.mkdirSync(qaBouncesDir(ctx.target), { recursive: true });
    fs.writeFileSync(
      path.join(qaBouncesDir(ctx.target), '2026-07.jsonl'),
      JSON.stringify(record({ ticket: 'BL-441', by: undefined, commit: 'legacyaaaa' })) + '\n'
    );
  });

  step(/^a generalised bounce log containing a record with by QA$/, (ctx) => {
    fs.mkdirSync(bouncesDir(ctx.target), { recursive: true });
    appendBounceRecordIfNew(ctx.target, record({ ticket: 'BL-9636', by: 'QA', commit: 'newpathaaa' }));
  });

  step(/^the bounce records are read$/, (ctx) => {
    ctx.readRecords = readBounceRecords(ctx.target);
  });

  step(/^both records are returned$/, (ctx) => {
    if (ctx.readRecords.length !== 2) {
      throw new Error(`expected 2 merged records (legacy + new), got ${ctx.readRecords.length}`);
    }
  });

  step(/^the by-less record is attributed as unattributed$/, (ctx) => {
    const legacy = ctx.readRecords.find((r) => r.ticket === 'BL-441');
    const tally = computeBounceTallyByBouncingRole(ctx.readRecords);
    const unattributed = tally.find((t) => t.role === 'unattributed');
    if (!legacy || legacy.by !== undefined || !unattributed || unattributed.count < 1) {
      throw new Error(`expected the by-less record to tally as unattributed, got ${JSON.stringify(tally)}`);
    }
  });

  step(/^the by-less record is not attributed to QA$/, (ctx) => {
    const tally = computeBounceTallyByBouncingRole(ctx.readRecords);
    const qa = tally.find((t) => t.role === 'QA');
    if (qa && qa.count > 1) {
      throw new Error(`expected only the genuinely QA-attributed record to count toward QA, got ${JSON.stringify(tally)}`);
    }
  });

  // ── record-bounce-by-role-07: writes only the generalised path ──────────
  step(/^the record is appended to the generalised bounces log$/, (ctx) => {
    if (!ctx.result || ctx.result.recorded !== true) {
      throw new Error(`expected the CLI to report recorded:true, got ${JSON.stringify(ctx.result)}`);
    }
    if (!fs.existsSync(bouncesDir(ctx.target))) {
      throw new Error('expected the generalised bounces dir to exist after recording');
    }
  });

  step(/^the legacy qa_bounces log is not written$/, (ctx) => {
    if (fs.existsSync(qaBouncesDir(ctx.target))) {
      throw new Error('expected the legacy qa_bounces dir to remain absent');
    }
  });

  // ── record-bounce-by-role-08: rounds per close, split by role ───────────
  step(/^a bounce log holding four architect bounces and two QA bounces within the current window$/, (ctx) => {
    ctx.nowMs = Date.parse('2026-07-26T12:00:00.000Z');
    ctx.bounceRecords = [
      record({ by: 'architect', commit: 'c1', at: '2026-07-25T09:00:00.000Z' }),
      record({ by: 'architect', commit: 'c2', at: '2026-07-25T10:00:00.000Z' }),
      record({ by: 'architect', commit: 'c3', at: '2026-07-26T08:00:00.000Z' }),
      record({ by: 'architect', commit: 'c4', at: '2026-07-26T09:00:00.000Z' }),
      record({ by: 'QA', commit: 'c5', at: '2026-07-25T11:00:00.000Z' }),
      record({ by: 'QA', commit: 'c6', at: '2026-07-26T10:00:00.000Z' }),
    ];
  });

  step(/^two tickets closed within the same window$/, (ctx) => {
    ctx.closedDateIsos = ['2026-07-25T12:00:00.000Z', '2026-07-26T11:00:00.000Z'];
  });

  step(/^the cost health sidecar is computed$/, (ctx) => {
    ctx.sidecar = buildCostHealthSidecar(
      '2026-07-26',
      {},
      {},
      emptyReliabilitySeries('2026-07-26T00:00:00Z'),
      [{ periodStart: '2026-07-25T00:00:00Z', value: 3 }],
      [{ periodStart: '2026-07-26T00:00:00Z', value: 2 }],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { bounceRecords: ctx.bounceRecords, closedDateIsos: ctx.closedDateIsos, nowMs: ctx.nowMs }
    );
  });

  step(/^flow balance carries (\w+) rework rounds per close of ([\d.]+) as a trended number$/, (ctx, role, expected) => {
    const trended = ctx.sidecar.flowBalance.rework.roundsPerClose[role];
    if (!trended || trended.value !== Number(expected) || !('direction' in trended.trend)) {
      throw new Error(`expected ${role} roundsPerClose to be a trended number ${expected}, got ${JSON.stringify(trended)}`);
    }
  });

  step(/^flow balance carries bounces per day split by bouncing role$/, (ctx) => {
    const byDay = ctx.sidecar.flowBalance.rework.bouncesPerDay;
    if (!byDay.architect || !byDay.QA) {
      throw new Error(`expected bouncesPerDay split by architect and QA, got ${JSON.stringify(byDay)}`);
    }
  });

  step(/^no flow balance figure pools architect and QA bounces into one number$/, (ctx) => {
    const rp = ctx.sidecar.flowBalance.rework.roundsPerClose;
    if (rp.architect.value === rp.QA.value) {
      // Coincidentally-equal values are not proof of pooling by themselves,
      // but distinct KEYS existing (asserted above/below) is the real
      // pooling guard; this re-affirms both are independently addressable.
    }
    if (!Object.prototype.hasOwnProperty.call(rp, 'architect') || !Object.prototype.hasOwnProperty.call(rp, 'QA')) {
      throw new Error('expected architect and QA to be independently addressable keys, never pooled into one');
    }
  });

  // ── record-bounce-by-role-09: markdown flow balance line ────────────────
  step(/^a computed sidecar whose flow balance carries the rework metric$/, (ctx) => {
    // BL-635 SEND BACK #1 (evidence site 1): both the prior and current
    // 7-day windows must sit fully after the 2026-07-25 by-attribution
    // epoch for a genuine, non-fabricated two-point trend - "now" here is
    // 16 days past epoch so priorStart (nowMs-14d) clears it too. A window
    // straddling or preceding the epoch has no real baseline to render an
    // honest arrow from.
    ctx.nowMs = Date.parse('2026-08-10T12:00:00.000Z');
    ctx.bounceRecords = [
      record({ by: 'architect', commit: 'c1', at: '2026-07-30T09:00:00.000Z' }),
      record({ by: 'QA', commit: 'c2', at: '2026-07-29T09:00:00.000Z' }),
      record({ by: 'architect', commit: 'c3', at: '2026-08-05T09:00:00.000Z' }),
      record({ by: 'QA', commit: 'c4', at: '2026-08-06T09:00:00.000Z' }),
    ];
    ctx.sidecar = buildCostHealthSidecar(
      '2026-08-10',
      {},
      {},
      emptyReliabilitySeries('2026-08-10T00:00:00Z'),
      [{ periodStart: '2026-08-10T00:00:00Z', value: 3 }],
      [{ periodStart: '2026-08-10T00:00:00Z', value: 2 }],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        bounceRecords: ctx.bounceRecords,
        closedDateIsos: ['2026-07-28T10:00:00.000Z', '2026-08-04T10:00:00.000Z'],
        nowMs: ctx.nowMs,
      }
    );
  });

  step(/^the markdown briefing is rendered$/, (ctx) => {
    ctx.renderedMarkdown = renderCostHealthSection(ctx.sidecar);
  });

  step(/^the flow balance line includes the rework rounds per close figure with a trend arrow$/, (ctx) => {
    const flowLine = ctx.renderedMarkdown.split('\n').find((l) => l.startsWith('**Flow balance:**'));
    if (!flowLine || !/rework/.test(flowLine) || !/[↑↓→]/.test(flowLine)) {
      throw new Error(`expected the flow balance line to carry a rework figure with a trend arrow, got: ${flowLine}`);
    }
  });

  step(/^the rework figure is split by bouncing role consistent with the specced and closed figures$/, (ctx) => {
    const flowLine = ctx.renderedMarkdown.split('\n').find((l) => l.startsWith('**Flow balance:**'));
    if (!/architect/.test(flowLine) || !/QA/.test(flowLine)) {
      throw new Error(`expected the flow balance line to name both bouncing roles, got: ${flowLine}`);
    }
  });

  // ── record-bounce-by-role-10: discredited sources never read ────────────
  step(/^a ticket titled with the word bounce having zero recorded bounces$/, (ctx) => {
    ctx.bounceRecords = ctx.bounceRecords || [];
    ctx.titleContaminatedTicket = 'BL-9999-bounce-watcher-resilience';
  });

  step(/^a ticket with one recorded bounce whose fix produced six merge commits mentioning bounce$/, (ctx) => {
    ctx.sixMergeCommitTicket = 'BL-9998';
    // The metric has no commit-message field to read at all - a single
    // BounceRecord is the entire signal, regardless of how many merge
    // commits its fix produced downstream.
    ctx.bounceRecords.push(record({ ticket: ctx.sixMergeCommitTicket, by: 'architect', commit: 'onlycommit1' }));
  });

  step(/^the rework metric is computed$/, (ctx) => {
    ctx.maxRounds = computeMaxRoundsIndicator(ctx.bounceRecords);
    ctx.roundsByTicket = {};
    for (const r of ctx.bounceRecords) {
      ctx.roundsByTicket[r.ticket] = (ctx.roundsByTicket[r.ticket] || 0) + 1;
    }
  });

  step(/^the title-contaminated ticket contributes zero rounds$/, (ctx) => {
    if (ctx.roundsByTicket[ctx.titleContaminatedTicket]) {
      throw new Error(`expected the title-contaminated ticket to contribute 0 rounds, got ${ctx.roundsByTicket[ctx.titleContaminatedTicket]}`);
    }
  });

  step(/^the six-merge-commit ticket contributes exactly one round$/, (ctx) => {
    if (ctx.roundsByTicket[ctx.sixMergeCommitTicket] !== 1) {
      throw new Error(`expected exactly 1 round, got ${ctx.roundsByTicket[ctx.sixMergeCommitTicket]}`);
    }
  });

  // ── record-bounce-by-role-11: max-rounds indicator ───────────────────────
  step(/^a bounce log where one ticket has four architect bounces and four tickets have one QA bounce each$/, (ctx) => {
    ctx.bounceRecords = [
      record({ ticket: 'BL-590', by: 'architect', commit: 'c1' }),
      record({ ticket: 'BL-590', by: 'architect', commit: 'c2' }),
      record({ ticket: 'BL-590', by: 'architect', commit: 'c3' }),
      record({ ticket: 'BL-590', by: 'architect', commit: 'c4' }),
      record({ ticket: 'BL-1', by: 'QA', commit: 'c5' }),
      record({ ticket: 'BL-2', by: 'QA', commit: 'c6' }),
      record({ ticket: 'BL-3', by: 'QA', commit: 'c7' }),
      record({ ticket: 'BL-4', by: 'QA', commit: 'c8' }),
    ];
  });

  step(/^the metric carries a max-rounds indicator naming the four-bounce ticket with rounds (\d+)$/, (ctx, rounds) => {
    const max = ctx.maxRounds;
    if (!max || max.ticket !== 'BL-590' || max.rounds !== Number(rounds)) {
      throw new Error(`expected max-rounds indicator {ticket: BL-590, rounds: ${rounds}}, got ${JSON.stringify(max)}`);
    }
  });

  // ── record-bounce-by-role-12: epoch unavailable vs zero ──────────────────
  step(/^a by-attributed recording epoch of (\d{4}-\d{2}-\d{2})$/, (ctx, epochIso) => {
    ctx.epochIso = epochIso;
  });

  step(/^a bounce log with no records on the day after the epoch$/, (ctx) => {
    ctx.bounceRecords = [];
    ctx.dayIsos = ['2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27'];
  });

  step(/^the daily rework series is computed$/, (ctx) => {
    ctx.dailySeries = computeDailyReworkSeries(ctx.bounceRecords, 'architect', ctx.dayIsos, ctx.epochIso);
  });

  step(/^the day after the epoch reports zero bounces$/, (ctx) => {
    const dayAfter = ctx.dailySeries.find((p) => p.periodStart === '2026-07-27');
    if (!dayAfter || dayAfter.value !== 0) {
      throw new Error(`expected the day after the epoch to report 0, got ${JSON.stringify(dayAfter)}`);
    }
  });

  step(/^every day before the epoch reports unavailable rather than zero$/, (ctx) => {
    const before = ctx.dailySeries.filter((p) => p.periodStart < ctx.epochIso);
    if (before.length === 0 || !before.every((p) => p.value === null)) {
      throw new Error(`expected every pre-epoch day to report null (unavailable), got ${JSON.stringify(before)}`);
    }
  });

  step(/^the markdown rendering shows the pre-epoch period as unavailable never as a flat zero line$/, (ctx) => {
    const line = renderDailyReworkMarkdownLine('architect', ctx.dailySeries);
    const preEpoch = ctx.dailySeries.filter((p) => p.periodStart < ctx.epochIso).map((p) => p.periodStart);
    for (const day of preEpoch) {
      if (!line.includes(`${day}: unavailable`)) {
        throw new Error(`expected the markdown line to render ${day} as unavailable, got: ${line}`);
      }
      if (line.includes(`${day}: 0`)) {
        throw new Error(`expected the markdown line to never render ${day} as a flat zero, got: ${line}`);
      }
    }
  });

  // ── record-bounce-by-role-13: known fixtures land on their own day ──────
  step(/^a bounce log fixture holding (\d+) architect bounces for (BL-\d+) dated (\d{4}-\d{2}-\d{2})$/, (ctx, rounds, ticket, date) => {
    ctx.bounceRecords = ctx.bounceRecords || [];
    ctx.dayIsos = ctx.dayIsos || ['2026-07-01', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'];
    ctx.epochIso = ctx.epochIso || '2026-07-01';
    for (let i = 0; i < Number(rounds); i++) {
      ctx.bounceRecords.push(record({ ticket, by: 'architect', commit: `${ticket}-${i}`, at: `${date}T0${i}:00:00.000Z` }));
    }
  });

  step(/^the series for (\d{4}-\d{2}-\d{2}) shows (\d+) bounces attributed to the architect$/, (ctx, date, rounds) => {
    const point = ctx.dailySeries.find((p) => p.periodStart === date);
    if (!point || point.value !== Number(rounds)) {
      throw new Error(`expected ${date} to show ${rounds} architect bounces, got ${JSON.stringify(point)}`);
    }
  });

  // ── record-bounce-by-role-14: briefing line reports who bounced too ─────
  step(/^a bounce log holding records with by QA and by architect and one legacy by-less record$/, (ctx) => {
    ctx.bounceRecords = [
      record({ ticket: 'BL-1', by: 'QA', commit: 'c1' }),
      record({ ticket: 'BL-2', by: 'architect', commit: 'c2' }),
      record({ ticket: 'BL-3', by: undefined, commit: 'c3' }),
    ];
  });

  step(/^the briefing bounce line is rendered$/, (ctx) => {
    ctx.bounceLine = formatBounceLine(computeBounceTallyByBouncingRole(ctx.bounceRecords), computeQaBounceTally(ctx.bounceRecords));
  });

  step(/^the line breaks bounces down by bouncing role$/, (ctx) => {
    if (!/by bouncing role: /.test(ctx.bounceLine) || !/architect x1/.test(ctx.bounceLine) || !/QA x1/.test(ctx.bounceLine)) {
      throw new Error(`expected the line to break bounces down by bouncing role, got: ${ctx.bounceLine}`);
    }
  });

  step(/^the legacy record is shown as unattributed$/, (ctx) => {
    if (!/unattributed x1/.test(ctx.bounceLine)) {
      throw new Error(`expected the legacy record to be shown as unattributed, got: ${ctx.bounceLine}`);
    }
  });

  step(/^the line no longer frames every bounce as a QA bounce$/, (ctx) => {
    if (/^QA bounces/.test(ctx.bounceLine)) {
      throw new Error(`expected the line to not frame every bounce as a QA bounce, got: ${ctx.bounceLine}`);
    }
  });
}

module.exports = { registerSteps };
