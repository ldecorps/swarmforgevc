'use strict';

// BL-338: step handlers for "the average cost of delivering a ticket is a
// number the human can watch fall". Drives the REAL compiled producers
// (out/metrics/costTelemetry.js, out/metrics/gitHistoryAdapter.js,
// out/metrics/costPerTicket.js, out/notify/costHealthSidecar.js) against a
// real git repo (backlog tickets moved active -> done with controlled
// commit dates via GIT_AUTHOR/COMMITTER_DATE, never a real clock) and real
// transcript/handoff fixtures - same posture as burnMeterMasterResidentSteps.js
// and costHealthSidecarHeadlessSteps.js. Scenario -06 additionally renders
// the REAL pwa/index.html + pwa/app.js in jsdom (mirroring
// extension/test/pwaDashboard.test.js's own established pattern) so "the
// diagram reaches the surface" is proven against the actual rendering
// pipeline, not just the underlying data.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const RENDER_SCRIPT = path.join(EXT_DIR, 'scripts', 'render-cost-per-ticket-chart.js');
const { computeCostTelemetry } = require(path.join(EXT_DIR, 'out', 'metrics', 'costTelemetry'));
const { deriveTicketLifecycles, runGitLog } = require(path.join(EXT_DIR, 'out', 'metrics', 'gitHistoryAdapter'));
const { computeCostPerTicketSeries } = require(path.join(EXT_DIR, 'out', 'metrics', 'costPerTicket'));
const { computeCostHealthSidecar } = require(path.join(EXT_DIR, 'out', 'notify', 'costHealthSidecar'));

const PRICED_MODEL = 'claude-sonnet-5';
const INPUT_RATE_PER_MTOK = 3; // pricingTable.ts's own claude-sonnet-5 rate

// Two delivery dates ~2 months apart - robustly distinct weekly buckets,
// satisfying "delivered across more than one period" without depending on
// exact week-boundary alignment.
const SPEC_1_ISO = '2026-01-01T09:00:00Z';
const CLOSE_1_ISO = '2026-01-05T17:00:00Z';
const SPEC_2_ISO = '2026-03-01T09:00:00Z';
const CLOSE_2_ISO = '2026-03-09T17:00:00Z';

function mkTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function git(cwd, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', args, { cwd, env, encoding: 'utf8' });
}

function initRepo(root) {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);
}

// Moves a ticket from active/ -> done/ with controlled commit dates (no
// real clock), giving deriveTicketLifecycles a real specDateIso/closeDateIso
// pair to read back via git history.
function deliverTicket(root, ticketId, specIso, closeIso) {
  const relActive = path.join('backlog', 'active', `${ticketId}.yaml`);
  fs.writeFileSync(path.join(root, relActive), `id: ${ticketId}\n`);
  git(root, ['add', relActive]);
  git(root, ['commit', '-q', '-m', `spec ${ticketId}`], specIso);
  const relDone = path.join('backlog', 'done', `${ticketId}.yaml`);
  git(root, ['mv', relActive, relDone]);
  git(root, ['commit', '-q', '-m', `close ${ticketId}`], closeIso);
}

function slugFor(worktreePath) {
  return worktreePath.replace(/[/.]/g, '-');
}

let transcriptSeq = 0;
// Writes one priced-model transcript record inside worktreePath's own
// claudeProjectsDir slug - the same real reader (readTranscriptUsage) every
// producer under test shares.
function writeTranscriptRecord(claudeProjectsDir, worktreePath, inputTokens, atIso) {
  const dir = path.join(claudeProjectsDir, slugFor(worktreePath));
  fs.mkdirSync(dir, { recursive: true });
  transcriptSeq += 1;
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: atIso,
    message: {
      id: `m${transcriptSeq}`,
      model: PRICED_MODEL,
      usage: { input_tokens: inputTokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  });
  fs.writeFileSync(path.join(dir, `s${transcriptSeq}.jsonl`), line + '\n');
}

let handoffSeq = 0;
// Writes one completed .handoff header record - the real reader
// (readRoleHoldingWindows) derives a ticket-holding window from its
// task/dequeued_at/completed_at fields. Two calls for the same
// worktreePath+ticketId model a bounce: the ticket held twice, each hold its
// own window, both contributing usage to the same ticketId bucket.
function writeHoldingWindow(worktreePath, ticketId, dequeuedIso, completedIso) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(dir, { recursive: true });
  handoffSeq += 1;
  const content = `type: git_handoff\ntask: ${ticketId}-some-slice\ndequeued_at: ${dequeuedIso}\ncompleted_at: ${completedIso}\n\nbody`;
  fs.writeFileSync(path.join(dir, `h${handoffSeq}.handoff`), content);
}

function expectedCostUsd(inputTokens) {
  return (inputTokens / 1_000_000) * INPUT_RATE_PER_MTOK;
}

function computeReal(ctx) {
  ctx.costTelemetryByRole = computeCostTelemetry('/unused/target', ctx.roles, ctx.claudeProjectsDir);
  ctx.lifecycles = [...deriveTicketLifecycles(runGitLog(ctx.root, 'backlog')).values()];
  ctx.costPerTicketSeries = computeCostPerTicketSeries(ctx.lifecycles, ctx.costTelemetryByRole);
}

function registerSteps(registry) {
  // ── Background: tickets delivered across more than one period ───────
  registry.define(/^tickets that have been delivered, and recorded usage for the roles that worked on them$/, (ctx) => {
    ctx.root = mkTmp('aps-cost-per-ticket-');
    ctx.claudeProjectsDir = mkTmp('aps-cost-per-ticket-projects-');
    initRepo(ctx.root);

    const coderWt = mkTmp('aps-cost-per-ticket-coder-');
    ctx.roles = [{ role: 'coder', worktreePath: coderWt }];

    deliverTicket(ctx.root, 'BL-901', SPEC_1_ISO, CLOSE_1_ISO);
    writeHoldingWindow(coderWt, 'BL-901', SPEC_1_ISO, CLOSE_1_ISO);
    writeTranscriptRecord(ctx.claudeProjectsDir, coderWt, 1_000_000, '2026-01-03T12:00:00Z');

    deliverTicket(ctx.root, 'BL-902', SPEC_2_ISO, CLOSE_2_ISO);
    writeHoldingWindow(coderWt, 'BL-902', SPEC_2_ISO, CLOSE_2_ISO);
    writeTranscriptRecord(ctx.claudeProjectsDir, coderWt, 1_000_000, '2026-03-05T12:00:00Z');

    ctx.knownTicketId = 'BL-901';
    ctx.knownTicketExpectedUsd = expectedCostUsd(1_000_000);
  });

  // ── cost-per-ticket-diagram-02 Given: a master-resident role ─────────
  registry.define(/^a role that is master-resident worked on a ticket$/, (ctx) => {
    const masterWt = mkTmp('aps-cost-per-ticket-master-');
    ctx.roles.push({ role: 'coordinator', worktreePath: masterWt }, { role: 'specifier', worktreePath: masterWt });
    writeHoldingWindow(masterWt, 'BL-901', SPEC_1_ISO, CLOSE_1_ISO);
    writeTranscriptRecord(ctx.claudeProjectsDir, masterWt, 200_000, '2026-01-03T13:00:00Z');
  });

  // ── cost-per-ticket-diagram-03 Given: a bounced, reworked ticket ─────
  registry.define(/^a ticket was bounced and reworked before it was delivered$/, (ctx) => {
    const coderWt = ctx.roles.find((r) => r.role === 'coder').worktreePath;
    // A second, later hold of the SAME ticket by the SAME role - the real
    // shape a bounce-then-rework cycle leaves behind (two separate
    // dequeued_at/completed_at windows for one ticketId).
    const reworkDequeuedIso = '2026-01-04T09:00:00Z';
    const reworkCompletedIso = '2026-01-04T17:00:00Z';
    writeHoldingWindow(coderWt, 'BL-901', reworkDequeuedIso, reworkCompletedIso);
    writeTranscriptRecord(ctx.claudeProjectsDir, coderWt, 500_000, '2026-01-04T12:00:00Z');
    ctx.knownTicketExpectedUsd = expectedCostUsd(1_000_000) + expectedCostUsd(500_000);
  });

  // ── cost-per-ticket-diagram-05 Given: reaffirms the Background's own
  // two-period delivery (BL-901 in January, BL-902 in March) ───────────
  registry.define(/^tickets were delivered across more than one period$/, (ctx) => {
    if (!ctx.root) {
      throw new Error('expected the Background to have already delivered tickets across more than one period');
    }
  });

  // ── shared When: "produced" (data-level) ─────────────────────────────
  registry.define(/^the average cost per ticket is produced$/, (ctx) => {
    computeReal(ctx);
  });

  // ── shared When: "shown to the human" (full sidecar + basis) ────────
  registry.define(/^the average cost per ticket is shown to the human$/, (ctx) => {
    computeReal(ctx);
    ctx.sidecar = computeCostHealthSidecar(ctx.root, ctx.roles, undefined, ctx.claudeProjectsDir);
  });

  // ── cost-per-ticket-diagram-01 Then ──────────────────────────────────
  registry.define(/^it is derived from the recorded usage of the roles that worked on those tickets$/, (ctx) => {
    const totals = {};
    for (const roleTelemetry of Object.values(ctx.costTelemetryByRole)) {
      for (const [ticketId, attributed] of Object.entries(roleTelemetry.byTicket)) {
        if (ticketId === 'unattributed') continue;
        totals[ticketId] = (totals[ticketId] ?? 0) + (attributed.costUsd ?? 0);
      }
    }
    const actual = totals[ctx.knownTicketId];
    if (Math.abs(actual - ctx.knownTicketExpectedUsd) > 0.0001) {
      throw new Error(`expected ${ctx.knownTicketId}'s cost to equal the real recorded usage's priced cost ($${ctx.knownTicketExpectedUsd}), got $${actual}`);
    }
  });

  // ── cost-per-ticket-diagram-02 Then ──────────────────────────────────
  registry.define(/^that role's usage is counted once$/, (ctx) => {
    const keys = Object.keys(ctx.costTelemetryByRole);
    if (!keys.includes('coordinator+specifier')) {
      throw new Error(`expected one combined "coordinator+specifier" key, got: ${JSON.stringify(keys)}`);
    }
    if (ctx.costTelemetryByRole.coordinator !== undefined || ctx.costTelemetryByRole.specifier !== undefined) {
      throw new Error('expected no independent per-role entries for the master-resident pair - its usage would be counted twice');
    }
  });

  // ── cost-per-ticket-diagram-03 Then ──────────────────────────────────
  registry.define(/^the rework is either included in the ticket's cost or declared as excluded$/, (ctx) => {
    const totals = {};
    for (const roleTelemetry of Object.values(ctx.costTelemetryByRole)) {
      for (const [ticketId, attributed] of Object.entries(roleTelemetry.byTicket)) {
        if (ticketId === 'unattributed') continue;
        totals[ticketId] = (totals[ticketId] ?? 0) + (attributed.costUsd ?? 0);
      }
    }
    const actual = totals[ctx.knownTicketId];
    if (Math.abs(actual - ctx.knownTicketExpectedUsd) > 0.0001) {
      throw new Error(`expected the bounce's rework usage to be INCLUDED in the ticket's total (expected $${ctx.knownTicketExpectedUsd}, got $${actual}) - the ticket's own notes require inclusion or a loud declared exclusion, and this figure does neither`);
    }
  });

  // ── cost-per-ticket-diagram-04 Then ──────────────────────────────────
  registry.define(/^the surface states what the number includes and excludes$/, (ctx) => {
    const basis = ctx.sidecar.costPerTicket && ctx.sidecar.costPerTicket.basis;
    if (!basis || !/includes?/i.test(basis) || !/exclud/i.test(basis)) {
      throw new Error(`expected the surface to carry an accounting-basis statement naming both what is included and excluded, got: ${JSON.stringify(basis)}`);
    }
  });

  // ── cost-per-ticket-diagram-05 Then ──────────────────────────────────
  registry.define(/^the change over time is visible$/, (ctx) => {
    const series = ctx.sidecar.costPerTicket && ctx.sidecar.costPerTicket.series;
    if (!series || series.length < 2) {
      throw new Error(`expected at least two periods in the trend series (tickets delivered ~2 months apart), got: ${JSON.stringify(series)}`);
    }
  });

  // ── cost-per-ticket-diagram-06 Then ──────────────────────────────────
  registry.define(/^the diagram is present on the surface the human actually looks at$/, (ctx) => {
    if (!ctx.sidecar) {
      // scenario -06 shares the "produced" When (data-level only) - build
      // the full sidecar here since this Then is the one that needs it.
      ctx.sidecar = computeCostHealthSidecar(ctx.root, ctx.roles, undefined, ctx.claudeProjectsDir);
    }
    const backlogData = {
      schemaVersion: 1,
      generatedAtIso: '2026-03-10T00:00:00Z',
      sourceSha: 'abc123',
      board: { active: [], paused: [], doneByMilestone: {} },
      needsApproval: [],
      notDoneCount: 0,
      metrics: {
        velocity: { weeklySeries: [], trend: { direction: 'flat' }, rollingWindowCount: 0, rollingWindowDays: 7 },
        burndown: [],
        cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' } },
        forecasts: { tickets: [], milestones: [] },
      },
      costHealth: ctx.sidecar,
    };
    const fixturePath = path.join(mkTmp('aps-cost-per-ticket-render-'), 'backlog.json');
    fs.writeFileSync(fixturePath, JSON.stringify(backlogData));
    const out = execFileSync('node', [RENDER_SCRIPT, fixturePath], { encoding: 'utf8' });
    const result = JSON.parse(out);
    if (!result.hasSvg) {
      throw new Error(`expected the average cost/ticket diagram (an SVG chart) to render on the real PWA surface, got: ${JSON.stringify(result)}`);
    }
  });
}

module.exports = { registerSteps };
