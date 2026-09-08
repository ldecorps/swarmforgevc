'use strict';

// BL-1476: the turn-profile producer sweep reads only what changed. Drives
// the REAL compiled runTurnProfileProducer/buildTurnProfileWindowForGroups/
// readPersistedTurnProfileWindows against real transcript fixtures under
// mkdtemp, with the REAL injected readFn/nowFn seams - never a JavaScript
// restatement of the change-detection or deadline decision.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildTurnProfileWindowForGroups,
  readPersistedTurnProfileWindows,
  readTranscriptSummaryStore,
  runTurnProfileProducer,
} = require('../../../extension/out/metrics/turnProfileProducer');
const { projectSlug } = require('../../../extension/out/metrics/transcriptUsage');

const FEATURE = 'BL-1476 The turn-profile producer sweep reads only what changed';
const BASE_MS = Date.parse('2026-01-01T00:00:00Z');

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function toolLine(atMs, toolName, input) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(atMs).toISOString(),
    message: { content: [{ type: 'tool_use', name: toolName, input }] },
  });
}

function gitLine(atMs) {
  return toolLine(atMs, 'Shell', { command: 'git merge --ff-only origin/main' });
}

function writeTranscript(dir, name, lines) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

// Real fs.readFileSync, wrapped only to OBSERVE which paths were opened for
// content this tick - the producer's own change-detection decides whether
// to call it at all.
function observingReadFn(opened) {
  return (filePath) => {
    opened.push(filePath);
    return fs.readFileSync(filePath, 'utf8');
  };
}

function runProducer(ctx, overrides = {}) {
  ctx.opened = [];
  const readFn = overrides.readFn ?? observingReadFn(ctx.opened);
  const result = runTurnProfileProducer({
    repoRoot: ctx.repoRoot,
    roleWorktrees: ctx.roleWorktrees,
    claudeProjectsDir: ctx.claudeProjectsDir,
    readFn,
    nowFn: overrides.nowFn,
    deadlineMs: overrides.deadlineMs,
  });
  ctx.lastResult = result;
  return result;
}

function telemetryDir(ctx) {
  return path.join(ctx.repoRoot, '.swarmforge', 'telemetry');
}

function currentTranscriptPaths(ctx) {
  const paths = [];
  for (const rw of ctx.roleWorktrees) {
    const dir = path.join(ctx.claudeProjectsDir, projectSlug(rw.worktreePath));
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      paths.push({ stage: rw.role, path: path.join(dir, name) });
    }
  }
  return paths;
}

function fullWalkRow(ctx) {
  const byStage = new Map();
  for (const { stage, path: p } of currentTranscriptPaths(ctx)) {
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage).push(p);
  }
  const groups = [...byStage.entries()].map(([stage, transcriptPaths]) => ({ stage, transcriptPaths }));
  return buildTurnProfileWindowForGroups(groups);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  scoped(registry, /^a scratch claude-projects directory holding fixture transcripts for two role worktrees$/, (ctx) => {
    ctx.repoRoot = mkTmp('aps-bl1476-repo-');
    ctx.claudeProjectsDir = mkTmp('aps-bl1476-projects-');
    const coderPath = path.join(ctx.repoRoot, '.worktrees', 'coder');
    const qaPath = path.join(ctx.repoRoot, '.worktrees', 'QA');
    fs.mkdirSync(coderPath, { recursive: true });
    fs.mkdirSync(qaPath, { recursive: true });
    ctx.roleWorktrees = [
      { role: 'coder', worktreePath: coderPath },
      { role: 'QA', worktreePath: qaPath },
    ];
    ctx.seq = 0;
  });

  scoped(registry, /^the producer's clock and content-read seam are injected so every transcript opened for content is observable$/, () => {
    // Narrative only - runProducer above always injects the real observing
    // readFn (or the scenario's own clock-coupled one); nothing to set up.
  });

  // ── scenarios 01/02 shared Given ─────────────────────────────────────
  scoped(registry, /^a completed tick has summarised 40 transcripts and written the day's row$/, (ctx) => {
    ctx.transcriptPaths = [];
    for (let i = 0; i < 20; i += 1) {
      const dir = path.join(ctx.claudeProjectsDir, projectSlug(ctx.roleWorktrees[0].worktreePath));
      ctx.transcriptPaths.push(writeTranscript(dir, `t${i}.jsonl`, [gitLine(BASE_MS + ctx.seq++ * 1000)]));
    }
    for (let i = 0; i < 20; i += 1) {
      const dir = path.join(ctx.claudeProjectsDir, projectSlug(ctx.roleWorktrees[1].worktreePath));
      ctx.transcriptPaths.push(writeTranscript(dir, `t${i}.jsonl`, [gitLine(BASE_MS + ctx.seq++ * 1000)]));
    }
    const first = runProducer(ctx);
    assert.equal(first.listed, 40, 'the seeding tick must list all 40 fixture transcripts');
    assert.equal(first.partial, false, 'the seeding tick must complete (no deadline configured)');
    ctx.rowAfterSeed = readPersistedTurnProfileWindows(telemetryDir(ctx))[0];
    assert.ok(ctx.rowAfterSeed, 'the seeding tick must have written a row');
  });

  // ── scenario 01 When/Then ────────────────────────────────────────────
  scoped(registry, /^a tick runs with no transcript changed$/, (ctx) => {
    runProducer(ctx);
  });

  scoped(registry, /^no transcript is opened for content$/, (ctx) => {
    assert.deepEqual(ctx.opened, []);
  });

  scoped(registry, /^the tick reports reading (\d+) of (\d+) transcripts$/, (ctx, read, listed) => {
    assert.equal(ctx.lastResult.read, Number(read));
    assert.equal(ctx.lastResult.listed, Number(listed));
  });

  scoped(registry, /^the day's row is written again unchanged$/, (ctx) => {
    const rows = readPersistedTurnProfileWindows(telemetryDir(ctx));
    assert.equal(rows.length, 1, 'still exactly one day\'s row');
    assert.deepEqual(rows[0], ctx.rowAfterSeed);
  });

  // ── scenario 02 Given/When/Then ──────────────────────────────────────
  scoped(registry, /^since then one transcript (grew by appended lines|was created|was deleted)$/, (ctx, change) => {
    ctx.changedPath = null;
    if (change === 'grew by appended lines') {
      ctx.changedPath = ctx.transcriptPaths[7];
      fs.appendFileSync(ctx.changedPath, `\n${gitLine(BASE_MS + ctx.seq++ * 1000)}\n`, 'utf8');
    } else if (change === 'was created') {
      const dir = path.join(ctx.claudeProjectsDir, projectSlug(ctx.roleWorktrees[0].worktreePath));
      ctx.changedPath = writeTranscript(dir, 'new.jsonl', [gitLine(BASE_MS + ctx.seq++ * 1000)]);
    } else {
      ctx.changedPath = ctx.transcriptPaths[3];
      fs.unlinkSync(ctx.changedPath);
    }
  });

  // Shared by scenarios 02 and 03: scenario 03's own prior Given steps set
  // ctx.deadlineReadFn/ctx.nowFn/ctx.deadlineMs; scenario 02 sets none of
  // them, so the plain observing seam (no deadline) applies.
  scoped(registry, /^a tick runs$/, (ctx) => {
    ctx.opened = [];
    ctx.lastResult = runTurnProfileProducer({
      repoRoot: ctx.repoRoot,
      roleWorktrees: ctx.roleWorktrees,
      claudeProjectsDir: ctx.claudeProjectsDir,
      readFn: ctx.deadlineReadFn ?? observingReadFn(ctx.opened),
      nowFn: ctx.nowFn,
      deadlineMs: ctx.deadlineMs,
    });
  });

  scoped(registry, /^no transcript other than the changed one is opened for content$/, (ctx) => {
    if (ctx.opened.length === 0) {
      // The "was deleted" arm reads nothing at all - a deletion is detected
      // purely by absence from the current listing, never by opening it.
      return;
    }
    assert.deepEqual(ctx.opened, [ctx.changedPath]);
  });

  scoped(registry, /^the day's row equals the row a full walk of the current transcripts produces$/, (ctx) => {
    const rows = readPersistedTurnProfileWindows(telemetryDir(ctx));
    const row = rows[rows.length - 1];
    assert.deepEqual(row, fullWalkRow(ctx));
  });

  // ── scenario 03 Given/When/Then ──────────────────────────────────────
  scoped(registry, /^40 transcripts none of which has a summary$/, (ctx) => {
    ctx.transcriptPaths = [];
    for (let i = 0; i < 40; i += 1) {
      const rw = ctx.roleWorktrees[i % 2];
      const dir = path.join(ctx.claudeProjectsDir, projectSlug(rw.worktreePath));
      ctx.transcriptPaths.push(writeTranscript(dir, `d${i}.jsonl`, [gitLine(BASE_MS + ctx.seq++ * 1000)]));
    }
  });

  scoped(registry, /^the clock advances 10 seconds per transcript read$/, (ctx) => {
    ctx.clockMs = 0;
    ctx.nowFn = () => ctx.clockMs;
    ctx.deadlineReadFn = (filePath) => {
      ctx.opened.push(filePath);
      ctx.clockMs += 10_000;
      return fs.readFileSync(filePath, 'utf8');
    };
  });

  scoped(registry, /^the tick deadline is (\d+) seconds$/, (ctx, seconds) => {
    ctx.deadlineMs = Number(seconds) * 1000;
  });

  scoped(registry, /^at most (\d+) transcripts are opened for content$/, (ctx, cap) => {
    assert.ok(ctx.opened.length <= Number(cap), `expected at most ${cap} opened, got ${ctx.opened.length}`);
  });

  scoped(registry, /^no row is written$/, (ctx) => {
    assert.deepEqual(readPersistedTurnProfileWindows(telemetryDir(ctx)), []);
  });

  scoped(registry, /^the tick reports a partial walk$/, (ctx) => {
    assert.equal(ctx.lastResult.partial, true);
  });

  scoped(registry, /^the summaries of the transcripts it completed are persisted$/, (ctx) => {
    const store = readTranscriptSummaryStore(telemetryDir(ctx));
    assert.equal(Object.keys(store).length, ctx.opened.length);
  });

  scoped(registry, /^a following tick with an unlimited deadline opens only the transcripts without a summary$/, (ctx) => {
    const priorOpenedCount = ctx.opened.length;
    const opened = [];
    ctx.lastResult = runTurnProfileProducer({
      repoRoot: ctx.repoRoot,
      roleWorktrees: ctx.roleWorktrees,
      claudeProjectsDir: ctx.claudeProjectsDir,
      readFn: observingReadFn(opened),
    });
    assert.equal(ctx.lastResult.partial, false);
    assert.equal(opened.length, 40 - priorOpenedCount, 'only the transcripts still missing a summary are opened');
  });

  scoped(registry, /^that tick's row equals the row a full walk of all 40 transcripts produces$/, (ctx) => {
    const rows = readPersistedTurnProfileWindows(telemetryDir(ctx));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], fullWalkRow(ctx));
  });
}

module.exports = { registerSteps };
