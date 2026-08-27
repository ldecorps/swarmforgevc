'use strict';

// BL-664: deterministic transcript walker — interval taxonomy and turnProfile.
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('../../../extension/test/helpers/tmpDir');
const {
  profileIntervalKind,
  walkTranscriptFiles,
  snapshotTranscriptFiles,
  transcriptsUnchanged,
} = require('../../../extension/out/metrics/transcriptWalker');
const { buildTurnProfileSeries } = require('../../../extension/out/metrics/turnProfile');

const FEATURE = 'deterministic turn profiler classifies transcript intervals into a trended series';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function ensureCtx(ctx) {
  ctx.fixtureRoot = ctx.fixtureRoot || mkTmpDir('aps-bl664-');
  ctx.transcriptDir = path.join(ctx.fixtureRoot, 'transcripts');
  fs.mkdirSync(ctx.transcriptDir, { recursive: true });
  return ctx;
}

function writeGitLine(ctx, relName = 'session.jsonl', atMs = 1_700_000_000_000) {
  ensureCtx(ctx);
  const file = path.join(ctx.transcriptDir, relName);
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: new Date(atMs).toISOString(),
    message: {
      content: [
        {
          type: 'tool_use',
          name: 'Shell',
          input: { command: 'git merge --ff-only origin/main' },
        },
      ],
    },
  });
  fs.writeFileSync(file, `${line}\n`, 'utf8');
  ctx.transcriptPaths = [file];
  return file;
}

function registerSteps(registry) {
  scoped(registry, /^fixture role transcripts and handoff trail records for profiling$/, (ctx) => {
    ensureCtx(ctx);
    ctx.handoffTrail = [
      {
        ticketId: 'BL-664-FIXTURE',
        stage: 'coder',
        startMs: 1_700_000_000_000,
        endMs: 1_700_000_010_000,
      },
      {
        ticketId: 'BL-664-FIXTURE',
        stage: 'qa',
        startMs: 1_700_000_020_000,
        endMs: 1_700_000_030_000,
      },
    ];
    writeGitLine(ctx, 'coder-session.jsonl', 1_700_000_001_000);
  });

  scoped(registry, /^a transcript interval that is (.+)$/, (ctx, kind) => {
    ctx.intervalKind = kind.trim();
  });

  scoped(registry, /^the deterministic transcript walker profiles that interval$/, (ctx) => {
    ctx.lastCategory = profileIntervalKind(ctx.intervalKind);
  });

  scoped(registry, /^the interval is classified as (.+)$/, (ctx, category) => {
    if (ctx.lastCategory !== category.trim()) {
      throw new Error(`expected ${category}, got ${ctx.lastCategory}`);
    }
  });

  scoped(registry, /^role transcripts on disk before profiling$/, (ctx) => {
    ensureCtx(ctx);
    writeGitLine(ctx, 'readonly.jsonl');
    ctx.beforeSnapshots = snapshotTranscriptFiles(ctx.transcriptPaths);
  });

  scoped(registry, /^the deterministic transcript walker runs over those transcripts$/, (ctx) => {
    ctx.walkResult = walkTranscriptFiles(ctx.transcriptPaths, ctx.handoffTrail || []);
  });

  scoped(registry, /^every transcript file bytes and path remain unchanged$/, (ctx) => {
    if (!transcriptsUnchanged(ctx.beforeSnapshots, ctx.transcriptPaths)) {
      throw new Error('transcript bytes changed after profiling');
    }
  });

  scoped(registry, /^transcripts cover only a bounded time window$/, (ctx) => {
    ensureCtx(ctx);
    const start = 1_700_000_100_000;
    writeGitLine(ctx, 'bounded.jsonl', start);
    ctx.walkResult = walkTranscriptFiles(ctx.transcriptPaths, []);
  });

  scoped(registry, /^the walker profiles available history$/, (ctx) => {
    if (!ctx.walkResult) {
      ctx.walkResult = walkTranscriptFiles(ctx.transcriptPaths || [], ctx.handoffTrail || []);
    }
  });

  scoped(registry, /^the output states the coverage window$/, (ctx) => {
    if (!ctx.walkResult?.coverageWindow) {
      throw new Error('missing coverage window');
    }
  });

  scoped(registry, /^it does not extrapolate shares outside that window$/, (ctx) => {
    if (ctx.walkResult?.extrapolated) {
      throw new Error('walker extrapolated outside coverage window');
    }
  });

  scoped(registry, /^classified intervals across multiple pipeline stages$/, (ctx) => {
    ensureCtx(ctx);
    const coderFile = path.join(ctx.transcriptDir, 'multi-coder.jsonl');
    const qaFile = path.join(ctx.transcriptDir, 'multi-qa.jsonl');
    fs.writeFileSync(
      coderFile,
      `${JSON.stringify({
        type: 'assistant',
        timestamp: new Date(1_700_000_001_000).toISOString(),
        message: {
          content: [{ type: 'tool_use', name: 'Shell', input: { command: 'git fetch origin' } }],
        },
      })}\n`,
      'utf8'
    );
    fs.writeFileSync(
      qaFile,
      `${JSON.stringify({
        type: 'assistant',
        timestamp: new Date(1_700_000_025_000).toISOString(),
        message: {
          content: [{ type: 'tool_use', name: 'Read', input: { path: 'backlog/active/foo.yaml' } }],
        },
      })}\n`,
      'utf8'
    );
    ctx.transcriptPaths = [coderFile, qaFile];
    ctx.handoffTrail = [
      { ticketId: 'BL-664', stage: 'coder', startMs: 1_700_000_000_000, endMs: 1_700_000_010_000 },
      { ticketId: 'BL-664', stage: 'qa', startMs: 1_700_000_020_000, endMs: 1_700_000_030_000 },
    ];
    ctx.walkResult = walkTranscriptFiles(ctx.transcriptPaths, ctx.handoffTrail);
    ctx.turnProfile = buildTurnProfileSeries(ctx.walkResult.intervals, ctx.walkResult.coverageWindow);
  });

  scoped(registry, /^the walker aggregates a turnProfile series$/, (ctx) => {
    if (!ctx.turnProfile) {
      throw new Error('turnProfile not built');
    }
  });

  scoped(registry, /^each stage entry carries mechanical share and turn-overhead share$/, (ctx) => {
    for (const entry of ctx.turnProfile.stages) {
      if (!entry.mechanicalShare || typeof entry.mechanicalShare.value !== 'number') {
        throw new Error(`missing mechanicalShare for ${entry.stage}`);
      }
      if (!entry.turnOverheadShare || typeof entry.turnOverheadShare.value !== 'number') {
        throw new Error(`missing turnOverheadShare for ${entry.stage}`);
      }
    }
  });

  scoped(registry, /^the series uses the TrendedNumber shape for briefing and trend surfaces$/, (ctx) => {
    const entry = ctx.turnProfile.stages[0];
    if (!entry?.mechanicalShare?.trend || entry.mechanicalShare.trend.direction === undefined) {
      throw new Error('TrendedNumber trend missing on mechanicalShare');
    }
  });

  scoped(registry, /^transcript activity during an active ticket parcel$/, (ctx) => {
    ensureCtx(ctx);
    writeGitLine(ctx, 'parcel.jsonl', 1_700_000_002_000);
    ctx.handoffTrail = [
      {
        ticketId: 'BL-664-ACTIVE',
        stage: 'coder',
        startMs: 1_700_000_000_000,
        endMs: 1_700_000_010_000,
      },
    ];
  });

  scoped(registry, /^the walker profiles that window$/, (ctx) => {
    ctx.walkResult = walkTranscriptFiles(ctx.transcriptPaths, ctx.handoffTrail || []);
  });

  scoped(registry, /^each classified turn names its pipeline stage$/, (ctx) => {
    const withStage = ctx.walkResult.intervals.filter((row) => row.stage);
    if (withStage.length === 0) {
      throw new Error('no intervals attributed to a stage');
    }
  });

  scoped(registry, /^names the ticket id from the handoff trail when one is active$/, (ctx) => {
    const withTicket = ctx.walkResult.intervals.filter((row) => row.ticketId);
    if (withTicket.length === 0) {
      throw new Error('no intervals attributed to ticket id');
    }
  });

  scoped(registry, /^role transcripts written days before the profiler existed$/, (ctx) => {
    ensureCtx(ctx);
    const oldFile = path.join(ctx.transcriptDir, 'historical.jsonl');
    const oldMs = 1_600_000_000_000;
    fs.writeFileSync(
      oldFile,
      `${JSON.stringify({
        type: 'assistant',
        timestamp: new Date(oldMs).toISOString(),
        message: {
          content: [{ type: 'tool_use', name: 'Shell', input: { command: 'npm test' } }],
        },
      })}\n`,
      'utf8'
    );
    ctx.transcriptPaths = [oldFile];
  });

  scoped(registry, /^the deterministic transcript walker runs for the first time$/, (ctx) => {
    ctx.walkResult = walkTranscriptFiles(ctx.transcriptPaths, []);
    ctx.turnProfile = buildTurnProfileSeries(ctx.walkResult.intervals, ctx.walkResult.coverageWindow);
  });

  scoped(
    registry,
    /^those historical transcripts contribute classified intervals to turnProfile$/,
    (ctx) => {
      if (!ctx.turnProfile || ctx.turnProfile.stages.length === 0) {
        throw new Error('historical transcripts did not contribute to turnProfile');
      }
      if (ctx.walkResult.intervals.length === 0) {
        throw new Error('no classified intervals from historical transcripts');
      }
    }
  );

  scoped(registry, /^no transcript is required to be replayed through a live agent$/, (ctx) => {
    if (!ctx.walkResult?.transcriptPaths?.length) {
      throw new Error('walker did not read transcript files');
    }
  });
}

module.exports = { registerSteps };
