'use strict';

// BL-1364: step handlers for "The mechanical share of a turn is readable".
// Drives the REAL walker and the REAL production consumer
// (turnProfileProducer.buildTurnProfileWindowRecord) over fixture transcripts
// on disk — the point of the ticket is that a live caller exists, so the
// handler must exercise that caller rather than the series builder directly.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// mkProcessTmpDir, not mkTmpDir: this handler runs under specs/pipeline/
// runtime.js's plain `node --test`, never under Vitest, so mkTmpDir's
// afterEach sweep (registered only via vitest.config.mjs's setupFiles) never
// fires here - every acceptance run would leak its scratch root. Cleaned up
// on process exit instead (BL-971's sweep-by-prefix backstop still applies).
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');
const {
  buildTurnProfileWindowRecord,
} = require('../../../extension/out/metrics/turnProfileProducer');
const { INTERVAL_CATEGORIES } = require('../../../extension/out/metrics/transcriptWalker');

const FEATURE = 'The mechanical share of a turn is readable';

const BASE_MS = 1_700_000_000_000;
const WORKED_STAGE = 'coder';
const UNWORKED_STAGE = 'documenter';

// Scenario Outline values are load-bearing: the handler validates the captured
// example against the walker's OWN category set rather than a second list, and
// maps it to a transcript line the walker really classifies that way.
const CATEGORY_LINES = {
  'git-mechanical': (atMs) => shellLine(atMs, 'git merge --ff-only origin/main'),
  'test-run': (atMs) => shellLine(atMs, 'npm run test'),
  'thinking-writing': (atMs) => toolLine(atMs, 'Write', { file_path: '/tmp/n.md', content: 'prose' }),
  'turn-overhead': null, // produced by the walker's own boot interval, not a tool line
};

function toolLine(atMs, toolName, input) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(atMs).toISOString(),
    message: { content: [{ type: 'tool_use', name: toolName, input }] },
  });
}

function userLine(atMs) {
  return JSON.stringify({
    type: 'user',
    timestamp: new Date(atMs).toISOString(),
    message: { content: 'go' },
  });
}

function shellLine(atMs, command) {
  return toolLine(atMs, 'Shell', { command });
}

function ensureCtx(ctx) {
  if (!ctx.bl1364) {
    ctx.bl1364 = { root: mkProcessTmpDir('aps-bl1364-'), paths: [], trail: [] };
  }
  return ctx.bl1364;
}

function writeTranscript(state, name, lines) {
  const file = path.join(state.root, name);
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  state.paths.push(file);
  return file;
}

function trailFor(stage, startMs, endMs) {
  return { ticketId: 'BL-1364-FIXTURE', stage, startMs, endMs };
}

function stageEntry(state, stage) {
  return state.record.stages.find((entry) => entry.stage === stage);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^role transcripts covering a window have been walked$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^a stage whose turns include both mechanical and thinking intervals$/, (ctx) => {
    const state = ensureCtx(ctx);
    writeTranscript(state, 'coder.jsonl', [
      shellLine(BASE_MS + 1_000, 'git merge --ff-only origin/main'),
      toolLine(BASE_MS + 3_000, 'Write', { file_path: '/tmp/n.md', content: 'prose' }),
    ]);
    state.trail.push(trailFor(WORKED_STAGE, BASE_MS, BASE_MS + 10_000));
  });

  scoped(/^a stage with no classified turns in the window$/, (ctx) => {
    const state = ensureCtx(ctx);
    writeTranscript(state, 'coder-only.jsonl', [shellLine(BASE_MS + 1_000, 'git merge --ff-only origin/main')]);
    state.trail.push(trailFor(WORKED_STAGE, BASE_MS, BASE_MS + 10_000));
    // Declared in the trail, owns no interval anywhere in the window.
    state.trail.push(trailFor(UNWORKED_STAGE, BASE_MS + 500_000, BASE_MS + 510_000));
  });

  scoped(/^a transcript in the window cannot be read$/, (ctx) => {
    const state = ensureCtx(ctx);
    writeTranscript(state, 'coder.jsonl', [shellLine(BASE_MS + 1_000, 'git merge --ff-only origin/main')]);
    state.trail.push(trailFor(WORKED_STAGE, BASE_MS, BASE_MS + 10_000));
    // Genuinely unreadable: a damaged line with a COMPLETE record after it.
    // A torn FINAL line is a different condition - a transcript its agent is
    // still appending to - and is tolerated rather than treated as damage
    // (see turnProfileProducer.assessTranscriptReadability, and the
    // priority-00 note raised on this reading).
    const damaged = path.join(state.root, 'qa-damaged.jsonl');
    fs.writeFileSync(damaged, `garbage\n${shellLine(BASE_MS + 2_000, 'npm run test')}\n`, 'utf8');
    state.paths.push(damaged);
    state.partialPath = damaged;
  });

  scoped(/^a transcript in the window whose final line is torn mid-write$/, (ctx) => {
    const state = ensureCtx(ctx);
    // A worked stage alongside it, so "the window stays complete" is a claim
    // about a window that actually has something to report - otherwise the
    // scenario would pass on an empty series.
    writeTranscript(state, 'coder.jsonl', [
      shellLine(BASE_MS + 1_000, 'git merge --ff-only origin/main'),
      toolLine(BASE_MS + 3_000, 'Write', { file_path: '/tmp/n.md', content: 'prose' }),
    ]);
    state.trail.push(trailFor(WORKED_STAGE, BASE_MS, BASE_MS + 10_000));
    // The torn line is the LAST one and every line before it is whole: a
    // transcript its agent is mid-append to, which is what some transcript on
    // the live repo always looks like.
    const live = path.join(state.root, 'qa-live.jsonl');
    fs.writeFileSync(live, `${shellLine(BASE_MS + 2_000, 'npm run test')}\n{"type":"assis`, 'utf8');
    state.paths.push(live);
    state.tornTailPath = live;
  });

  scoped(/^the window is reported as complete$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.equal(
      state.record.complete,
      true,
      `a live append was treated as damage: ${JSON.stringify(state.record.unreadable_transcripts)}`
    );
    assert.deepEqual(state.record.unreadable_transcripts, []);
  });

  scoped(/^that transcript is named as having a truncated tail$/, (ctx) => {
    const state = ensureCtx(ctx);
    // Named, never silently absorbed - the condition has to stay visible to
    // whoever later reads the window.
    assert.deepEqual(state.record.truncated_tail_transcripts, [state.tornTailPath]);
  });

  scoped(/^a stage whose turns are entirely ([a-z-]+)$/, (ctx, category) => {
    const state = ensureCtx(ctx);
    assert.ok(
      INTERVAL_CATEGORIES.includes(category),
      `unknown category example "${category}" - the walker classifies ${INTERVAL_CATEGORIES.join(', ')}`
    );
    state.category = category;
    const makeLine = CATEGORY_LINES[category];
    if (makeLine) {
      writeTranscript(state, `${category}.jsonl`, [makeLine(BASE_MS + 1_000), makeLine(BASE_MS + 2_000)]);
      // The trail opens AFTER the walker's own boot interval so the stage's
      // turns really are entirely this category.
      state.trail.push(trailFor(WORKED_STAGE, BASE_MS + 900, BASE_MS + 10_000));
    } else {
      // turn-overhead is the walker's own boot-before-first-action interval:
      // the gap between a user turn opening and the first tool call. It has no
      // tool line of its own, so it is produced rather than written, and the
      // trail window is closed BEFORE the tool interval starts so this stage
      // owns the overhead alone.
      writeTranscript(state, 'overhead.jsonl', [
        userLine(BASE_MS + 1_000),
        shellLine(BASE_MS + 5_000, 'git merge --ff-only origin/main'),
      ]);
      state.trail.push(trailFor(WORKED_STAGE, BASE_MS + 900, BASE_MS + 1_500));
    }
  });

  scoped(/^the turn profile series is read$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.record = buildTurnProfileWindowRecord({
      transcriptPaths: state.paths,
      handoffTrail: state.trail,
    });
  });

  scoped(/^that stage reports a mechanical share$/, (ctx) => {
    const state = ensureCtx(ctx);
    const entry = stageEntry(state, WORKED_STAGE);
    assert.ok(entry, `expected ${WORKED_STAGE} in ${JSON.stringify(state.record.stages)}`);
    assert.equal(typeof entry.mechanical_share, 'number');
    assert.ok(entry.mechanical_share > 0, 'a worked stage reported no mechanical share at all');
  });

  scoped(/^the share reflects both kinds of interval$/, (ctx) => {
    const state = ensureCtx(ctx);
    const entry = stageEntry(state, WORKED_STAGE);
    // Strictly between 0 and 1 is only reachable when the thinking interval
    // shares the denominator with the mechanical one.
    assert.ok(entry.mechanical_share < 1, 'the thinking interval never entered the denominator');
    assert.ok(
      entry.category_shares['thinking-writing'] > 0,
      `the thinking interval is missing: ${JSON.stringify(entry.category_shares)}`
    );
  });

  scoped(/^that stage is absent from the series$/, (ctx) => {
    const state = ensureCtx(ctx);
    const names = state.record.stages.map((entry) => entry.stage);
    assert.ok(names.includes(WORKED_STAGE), 'the worked stage should still be present');
    assert.ok(
      !names.includes(UNWORKED_STAGE),
      `a stage nobody worked must be absent, not zero: ${JSON.stringify(state.record.stages)}`
    );
  });

  scoped(/^the window is reported as incomplete$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.equal(state.record.complete, false, 'a window with an unreadable transcript is not complete');
    assert.deepEqual(state.record.unreadable_transcripts, [state.partialPath]);
  });

  scoped(/^no stage from that window reports a share$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.deepEqual(state.record.stages, [], 'a partial window diluted a share instead of refusing one');
  });

  scoped(/^that stage reports its whole share as ([a-z-]+)$/, (ctx, category) => {
    const state = ensureCtx(ctx);
    assert.equal(category, state.category, 'the Then must assert the Given\'s own captured category');
    const entry = stageEntry(state, WORKED_STAGE);
    assert.ok(entry, `expected ${WORKED_STAGE} in ${JSON.stringify(state.record.stages)}`);
    assert.equal(
      entry.category_shares[category],
      1,
      `expected the whole share in ${category}, got ${JSON.stringify(entry.category_shares)}`
    );
  });
}

module.exports = { registerSteps };
