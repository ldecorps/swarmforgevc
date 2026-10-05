'use strict';

// BL-1947 (BL-132 stamp-off): step handlers for "mutation runs report
// progress and ETA durably". Drives the REAL MutationProgressReporter
// (extension/out/mutation/mutationProgressReporter.js) with injected
// now/write, backed by the REAL writeProgressRecord/readProgressRecord
// file-IO adapter against a fresh mkdtemp path - mirroring
// extension/test/{mutationProgress,mutationProgressFile,
// mutationProgressReporter}.test.js's own established fixture shapes,
// never a restatement of the progress/ETA math or the atomic-write logic.
// Per this ticket's own non-behavioral gate, Stryker itself is never
// spawned - the reporter's own hook methods are driven directly, exactly
// as Stryker would call them.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');

let _reporterModule = null;
function reporterModule() {
  if (!_reporterModule) _reporterModule = require(path.join(EXT_DIR, 'out', 'mutation', 'mutationProgressReporter.js'));
  return _reporterModule;
}
let _fileModule = null;
function fileModule() {
  if (!_fileModule) _fileModule = require(path.join(EXT_DIR, 'out', 'mutation', 'mutationProgressFile.js'));
  return _fileModule;
}

const START_MS = Date.parse('2026-09-09T12:00:00Z');

function planReadyEvent(runPlanCount) {
  return { mutantPlans: Array.from({ length: runPlanCount }, () => ({ plan: 'Run' })) };
}

const FEATURE = 'mutation runs report progress and ETA durably';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── durable-progress-01 ─────────────────────────────────────────────
  scoped(/^the hardener is running a Stryker mutation pass$/, (ctx) => {
    const { MutationProgressReporter } = reporterModule();
    const { defaultProgressFilePath, writeProgressRecord } = fileModule();
    ctx.root = trackedTmpRoot('sfvc-bl132-');
    ctx.filePath = defaultProgressFilePath(ctx.root, 'hardener');
    ctx.nowMs = START_MS;
    ctx.reporter = new MutationProgressReporter({
      now: () => ctx.nowMs,
      role: 'hardener',
      filePath: ctx.filePath,
      write: writeProgressRecord,
      mutateFile: 'src/foo.ts',
    });
    ctx.reporter.onMutationTestingPlanReady(planReadyEvent(4));
  });

  scoped(/^it is partway through$/, (ctx) => {
    ctx.nowMs = START_MS + 10_000;
    ctx.reporter.onMutantTested({ status: 'Killed' });
    ctx.midRunRecord = fileModule().readProgressRecord(ctx.filePath);
  });

  scoped(/^a durable file reports tested\/total, percent, survived, and an ETA$/, (ctx) => {
    assert.equal(ctx.midRunRecord.tested, 1);
    assert.equal(ctx.midRunRecord.total, 4);
    assert.equal(ctx.midRunRecord.percent, 25);
    assert.equal(ctx.midRunRecord.survived, 0);
    assert.equal(ctx.midRunRecord.eta_s, 30);
  });

  scoped(/^the file updates as the run advances and is finalized on completion$/, (ctx) => {
    ctx.nowMs = START_MS + 20_000;
    ctx.reporter.onMutantTested({ status: 'Survived' });
    const advancedRecord = fileModule().readProgressRecord(ctx.filePath);
    assert.equal(advancedRecord.tested, 2);
    assert.notEqual(advancedRecord.updated_at, ctx.midRunRecord.updated_at, 'the record must be refreshed, not left stale');

    ctx.nowMs = START_MS + 40_000;
    ctx.reporter.onMutantTested({ status: 'Killed' });
    ctx.reporter.onMutantTested({ status: 'Killed' });
    ctx.reporter.onMutationTestReportReady();
    ctx.finalRecord = fileModule().readProgressRecord(ctx.filePath);
    assert.equal(ctx.finalRecord.status, 'done');
    assert.equal(ctx.finalRecord.tested, 4);
  });

  scoped(/^it is readable without the extension\/webview \(plain file\)$/, (ctx) => {
    // A plain fs read + JSON.parse, with no extension/webview code in the
    // path at all - the durable file IS the contract.
    const raw = fs.readFileSync(ctx.filePath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed, ctx.finalRecord);
  });

  // ── hang-vs-progress-02 ──────────────────────────────────────────────
  scoped(/^the progress file's updated_at timestamp$/, (ctx) => {
    const { writeProgressRecord, defaultProgressFilePath } = fileModule();
    ctx.hangRoot = trackedTmpRoot('sfvc-bl132-hang-');
    ctx.hangFilePath = defaultProgressFilePath(ctx.hangRoot, 'hardener');
    const base = { tested: 1, total: 4, percent: 25, survived: 0, timedOut: 0, elapsed_s: 5, eta_s: 15, status: 'running' };
    writeProgressRecord(ctx.hangFilePath, { ...base, updated_at: new Date(START_MS).toISOString() });
    ctx.liveRead1 = fileModule().readProgressRecord(ctx.hangFilePath);
    // A live-advancing run: the next write refreshes updated_at (and
    // tested) - directly observable as a change in the file's own field,
    // never an inference from wall-clock elapsed time alone.
    writeProgressRecord(ctx.hangFilePath, { ...base, tested: 2, percent: 50, updated_at: new Date(START_MS + 10_000).toISOString() });
    ctx.liveRead2 = fileModule().readProgressRecord(ctx.hangFilePath);
    // A hung run: the SAME record rewritten with an UNCHANGED updated_at -
    // the one signal that distinguishes it from the live case above.
    writeProgressRecord(ctx.hangFilePath, { ...base, tested: 2, percent: 50, updated_at: new Date(START_MS + 10_000).toISOString() });
    ctx.hungRead = fileModule().readProgressRecord(ctx.hangFilePath);
  });

  scoped(
    /^a consumer can tell a live-advancing run from one that has stopped updating \(a hang\), per the constitution's long-run progress rule$/,
    (ctx) => {
      assert.notEqual(ctx.liveRead2.updated_at, ctx.liveRead1.updated_at, 'a live-advancing run must change updated_at between reads');
      assert.equal(ctx.hungRead.updated_at, ctx.liveRead2.updated_at, 'a hung run leaves updated_at unchanged - the distinguishing signal');
    }
  );
}

module.exports = { registerSteps };
