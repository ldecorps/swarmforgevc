'use strict';

// BL-665: context-telemetry producer wiring — transcript walker fills GH-22 store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('../../../extension/test/helpers/tmpDir');
const { startBridge } = require('../../../extension/out/bridge/bridgeServer');
const { runContextTelemetryProducer } = require('../../../extension/out/metrics/contextTelemetryProducer');
const { projectSlug } = require('../../../extension/out/metrics/transcriptUsage');
const { listTelemetryAgents, summarizeTelemetryForAgent } = require('../../../extension/out/bridge/contextTelemetryGate');

const FEATURE = 'a scheduled producer walks role transcripts and fills the context-telemetry store';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'context_telemetry_cli.bb');
const TOKEN = 'context-budget-token';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function slugFor(worktreePath) {
  return projectSlug(worktreePath);
}

function ensureCtx(ctx) {
  ctx.fixtureRoot = ctx.fixtureRoot || mkTmpDir('aps-bl665-');
  ctx.worktreePath = path.join(ctx.fixtureRoot, '.worktrees', 'coder');
  ctx.claudeProjectsDir = ctx.claudeProjectsDir || fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl665-projects-'));
  fs.mkdirSync(ctx.worktreePath, { recursive: true });
  fs.mkdirSync(path.join(ctx.fixtureRoot, '.swarmforge', 'telemetry'), { recursive: true });
  fs.writeFileSync(
    path.join(ctx.fixtureRoot, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${ctx.worktreePath}\tcoder\tcoder\tclaude\n`,
    'utf8'
  );
  return ctx;
}

function writeTranscript(ctx, lines, fileName = 'session.jsonl') {
  ensureCtx(ctx);
  const dir = path.join(ctx.claudeProjectsDir, slugFor(ctx.worktreePath));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), `${lines.join('\n')}\n`, 'utf8');
}

function assistantLine({ messageId, timestamp, inputTokens = 12000, outputTokens = 400 }) {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    message: {
      id: messageId,
      model: 'claude-sonnet-5',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}

function telemetryDirFor(ctx) {
  return path.join(ctx.fixtureRoot, '.swarmforge', 'telemetry');
}

function runProducer(ctx) {
  ctx.lastProducerResult = runContextTelemetryProducer({
    repoRoot: ctx.fixtureRoot,
    roleWorktrees: [{ role: 'coder', worktreePath: ctx.worktreePath }],
    providersByRole: new Map([['coder', 'claude']]),
    claudeProjectsDir: ctx.claudeProjectsDir,
    recordFn: (event) => {
      const args = [
        CLI,
        'record',
        '--agent',
        event.agent,
        '--role',
        event.role,
        '--session-id',
        event.session_id,
        '--timestamp',
        event.timestamp,
        '--input-tokens',
        String(event.input_tokens),
        '--output-tokens',
        String(event.output_tokens),
        '--context-utilization-pct',
        String(event.context_utilization_pct),
        '--compaction',
        event.compaction ? 'true' : 'false',
        '--provider',
        event.provider,
        '--model',
        event.model,
      ];
      execFileSync('bb', args, {
        encoding: 'utf8',
        env: { ...process.env, CONTEXT_TELEMETRY_STATE_DIR: telemetryDirFor(ctx) },
      });
    },
  });
}

function readEventCount(ctx) {
  const file = path.join(telemetryDirFor(ctx), 'context-events.jsonl');
  if (!fs.existsSync(file)) {
    return 0;
  }
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
}

function cliSummary(ctx, agent) {
  const out = execFileSync('bb', [CLI, 'summary', '--agent', agent], {
    encoding: 'utf8',
    env: { ...process.env, CONTEXT_TELEMETRY_STATE_DIR: telemetryDirFor(ctx) },
  });
  return JSON.parse(out);
}

function cliAgents(ctx) {
  const out = execFileSync('bb', [CLI, 'agents'], {
    encoding: 'utf8',
    env: { ...process.env, CONTEXT_TELEMETRY_STATE_DIR: telemetryDirFor(ctx) },
  });
  return JSON.parse(out);
}

async function fetchDashboard(ctx, agent) {
  const handle = await startBridge(ctx.fixtureRoot, path.join(ctx.fixtureRoot, 'runs.jsonl'), TOKEN, {});
  try {
    const base = `http://127.0.0.1:${handle.port}`;
    const htmlRes = await fetch(`${base}/context-budget`);
    ctx.html = await htmlRes.text();
    const qs = new URLSearchParams({ token: TOKEN, agent });
    const stateRes = await fetch(`${base}/context-budget-state?${qs.toString()}`);
    ctx.stateStatus = stateRes.status;
    ctx.state = stateRes.status === 200 ? await stateRes.json() : null;
  } finally {
    handle.stop();
  }
}

function registerSteps(registry) {
  scoped(registry, /^role transcripts exist for at least one real role on this host$/, (ctx) => {
    ensureCtx(ctx);
    writeTranscript(ctx, [
      assistantLine({
        messageId: 'live-1',
        timestamp: '2026-07-09T11:38:10.165Z',
        inputTokens: 12000,
        outputTokens: 400,
      }),
    ]);
  });

  scoped(registry, /^the context-telemetry store has never been populated$/, (ctx) => {
    ensureCtx(ctx);
    if (readEventCount(ctx) !== 0) {
      throw new Error('expected an empty context-telemetry store');
    }
  });

  scoped(registry, /^the context-telemetry store is empty$/, (ctx) => {
    ensureCtx(ctx);
    if (readEventCount(ctx) !== 0) {
      throw new Error('expected an empty context-telemetry store');
    }
  });

  scoped(registry, /^the transcript-walker producer runs once$/, (ctx) => {
    runProducer(ctx);
  });

  scoped(registry, /^"context_telemetry_cli\.bb summary" returns non-empty output$/, (ctx) => {
    const summary = cliSummary(ctx, 'coder');
    if (!summary || summary.event_count < 1) {
      throw new Error(`expected non-empty summary, got ${JSON.stringify(summary)}`);
    }
  });

  scoped(registry, /^"context_telemetry_cli\.bb agents" names a real role$/, (ctx) => {
    const agents = cliAgents(ctx);
    if (!Array.isArray(agents.agents) || !agents.agents.includes('coder')) {
      throw new Error(`expected agents to include coder, got ${JSON.stringify(agents)}`);
    }
  });

  scoped(registry, /^the transcript-walker producer has already ingested a given window of transcripts$/, (ctx) => {
    ensureCtx(ctx);
    writeTranscript(ctx, [
      assistantLine({ messageId: 'dup-1', timestamp: '2026-07-09T12:00:00.000Z' }),
    ]);
    runProducer(ctx);
    ctx.eventCountAfterFirstRun = readEventCount(ctx);
    if (ctx.eventCountAfterFirstRun < 1) {
      throw new Error('expected first producer run to record events');
    }
  });

  scoped(registry, /^the producer runs again over that same window$/, (ctx) => {
    runProducer(ctx);
    ctx.eventCountAfterSecondRun = readEventCount(ctx);
  });

  scoped(registry, /^the context-telemetry record count is unchanged$/, (ctx) => {
    if (ctx.eventCountAfterSecondRun !== ctx.eventCountAfterFirstRun) {
      throw new Error(
        `expected unchanged count ${ctx.eventCountAfterFirstRun}, got ${ctx.eventCountAfterSecondRun}`
      );
    }
  });

  scoped(registry, /^role transcripts exist from before the producer's first run$/, (ctx) => {
    ensureCtx(ctx);
    writeTranscript(ctx, [
      assistantLine({
        messageId: 'old-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        inputTokens: 8000,
      }),
      assistantLine({
        messageId: 'old-2',
        timestamp: '2026-01-02T00:00:00.000Z',
        inputTokens: 9000,
      }),
    ]);
  });

  scoped(registry, /^the transcript-walker producer runs for the first time$/, (ctx) => {
    runProducer(ctx);
    ctx.backfillEvents = readEventCount(ctx);
  });

  scoped(
    registry,
    /^it derives context-usage events for those pre-existing transcripts, not only new ones going forward$/,
    (ctx) => {
      if (ctx.backfillEvents < 2) {
        throw new Error(`expected backfill of historical transcripts, got ${ctx.backfillEvents} events`);
      }
    }
  );

  scoped(
    registry,
    /^the context-telemetry store was empty and the dashboard showed "No telemetry recorded yet"$/,
    async (ctx) => {
      ensureCtx(ctx);
      writeTranscript(ctx, [
        assistantLine({ messageId: 'dash-1', timestamp: '2026-07-09T13:00:00.000Z' }),
      ]);
      await fetchDashboard(ctx, 'coder');
      if (ctx.state?.summary?.event_count !== 0) {
        throw new Error('expected empty dashboard state before producer run');
      }
      if (!/No telemetry recorded yet for/.test(ctx.html)) {
        throw new Error('expected empty-store dashboard message');
      }
    }
  );

  scoped(registry, /^the transcript-walker producer runs and fills the store$/, async (ctx) => {
    runProducer(ctx);
    await fetchDashboard(ctx, 'coder');
  });

  scoped(registry, /^the dashboard no longer shows "No telemetry recorded yet"$/, (ctx) => {
    if (ctx.state?.summary?.event_count < 1) {
      throw new Error('expected filled store on dashboard state');
    }
    const agents = listTelemetryAgents(ctx.fixtureRoot);
    assert.ok(agents.includes('coder'));
    const summary = summarizeTelemetryForAgent(ctx.fixtureRoot, 'coder');
    assert.ok(summary.event_count >= 1);
  });
}

module.exports = { registerSteps };
