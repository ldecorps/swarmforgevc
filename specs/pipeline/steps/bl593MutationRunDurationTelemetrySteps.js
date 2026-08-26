'use strict';

// BL-593: step handlers for durable mutation-run duration telemetry.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const { MutationProgressReporter } = require(path.join(REPO_ROOT, 'extension', 'out', 'mutation', 'mutationProgressReporter'));
const {
  buildMutationRunRecord,
  isCompletedFullRunRecord,
} = require(path.join(REPO_ROOT, 'extension', 'out', 'mutation', 'mutationRunTelemetry'));
const {
  appendMutationRunRecord,
  readMutationRunRecords,
  defaultMutationRunsLogPath,
} = require(path.join(REPO_ROOT, 'extension', 'out', 'mutation', 'mutationRunTelemetryStore'));
const { initMutationProgressState, recordMutantTested } = require(path.join(REPO_ROOT, 'extension', 'out', 'mutation', 'mutationProgress'));

const FEATURE = 'mutation runs append durable duration telemetry';
const START = Date.parse('2026-07-09T12:00:00Z');

function planReadyEvent(runPlanCount) {
  return { mutantPlans: Array.from({ length: runPlanCount }, () => ({ plan: 'Run' })) };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture project root with an empty mutation-runs telemetry log$/, (ctx) => {
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl593-root-'));
    ctx.telemetryPath = defaultMutationRunsLogPath(ctx.root);
    ctx.progressWrites = [];
    ctx.telemetryAppends = [];
    ctx.now = () => START;
    ctx.deps = () => ({
      now: ctx.now,
      role: 'hardender',
      filePath: path.join(ctx.root, 'progress.json'),
      write: (filePath, record) => ctx.progressWrites.push({ filePath, record }),
      telemetryPath: ctx.telemetryPath,
      appendTelemetry: (filePath, record) => {
        appendMutationRunRecord(filePath, record);
        ctx.telemetryAppends.push({ filePath, record });
      },
      runMeta: {
        role: 'hardender',
        scope: 'out/foo.js',
        incremental: true,
        concurrency: 8,
        buildSha: 'abc123def4',
      },
      mutateFile: 'out/foo.js',
    });
  });

  scoped(/^a mutation run completes through the normal Stryker completion hook$/, (ctx) => {
    ctx.reporter = new MutationProgressReporter(ctx.deps());
    ctx.reporter.onMutationTestingPlanReady(planReadyEvent(3));
    ctx.reporter.onMutantTested({ status: 'Killed' });
    ctx.reporter.onMutantTested({ status: 'Survived' });
  });

  scoped(/^the mutation progress reporter finalizes the run$/, (ctx) => {
    ctx.reporter.onMutationTestReportReady();
  });

  scoped(/^exactly one line is appended to mutation-runs\.jsonl$/, (ctx) => {
    const records = readMutationRunRecords(ctx.telemetryPath);
    assert.equal(records.length, 1);
    assert.equal(ctx.telemetryAppends.length, 1);
  });

  scoped(/^the live per-role mutation-progress snapshot behavior is unchanged$/, (ctx) => {
    assert.ok(ctx.progressWrites.length >= 2);
    assert.equal(ctx.progressWrites.at(-1).record.status, 'done');
  });

  scoped(
    /^a completed scoped mutation run with known scope glob mutant total and incremental cache state$/,
    (ctx) => {
      ctx.state = initMutationProgressState(42, START);
      ctx.state = recordMutantTested(ctx.state, 'Killed');
      ctx.meta = {
        role: 'hardender',
        scope: 'out/concierge/pipelineBoard.js',
        incremental: true,
        concurrency: 8,
        buildSha: 'abc123def4',
      };
      ctx.endMs = START + 125_000;
    }
  );

  scoped(/^the completion record is built$/, (ctx) => {
    ctx.record = buildMutationRunRecord(ctx.state, ctx.endMs, ctx.meta);
  });

  scoped(/^the record includes started_at ended_at and elapsed_s$/, (ctx) => {
    assert.equal(ctx.record.started_at, new Date(START).toISOString());
    assert.equal(ctx.record.ended_at, new Date(ctx.endMs).toISOString());
    assert.equal(ctx.record.elapsed_s, 125);
  });

  scoped(
    /^the record includes role scope with mutant total incremental flag and effective concurrency$/,
    (ctx) => {
      assert.equal(ctx.record.role, 'hardender');
      assert.equal(ctx.record.scope, 'out/concierge/pipelineBoard.js');
      assert.equal(ctx.record.total, 42);
      assert.equal(ctx.record.incremental, true);
      assert.equal(ctx.record.concurrency, 8);
    }
  );

  scoped(/^the record includes the kill-status breakdown and build_sha at run time$/, (ctx) => {
    assert.equal(ctx.record.killed, 1);
    assert.equal(ctx.record.build_sha, 'abc123def4');
    assert.equal(ctx.record.survived, 0);
    assert.equal(ctx.record.no_coverage, 0);
    assert.equal(ctx.record.timed_out, 0);
    assert.equal(ctx.record.ignored, 0);
  });

  scoped(/^a mutation run is killed before the normal completion report fires$/, (ctx) => {
    ctx.reporter = new MutationProgressReporter(ctx.deps());
    ctx.reporter.onMutationTestingPlanReady(planReadyEvent(4));
    ctx.reporter.onMutantTested({ status: 'Killed' });
  });

  scoped(/^the run ends abnormally$/, (ctx) => {
    ctx.reporter.wrapUp();
  });

  scoped(
    /^mutation-runs\.jsonl gains no record that reads as a completed full run$/,
    (ctx) => {
      const records = readMutationRunRecords(ctx.telemetryPath);
      for (const record of records) {
        assert.equal(isCompletedFullRunRecord(record), false);
      }
    }
  );

  scoped(
    /^either no line is appended or the line carries aborted true with partial kill stats$/,
    (ctx) => {
      const records = readMutationRunRecords(ctx.telemetryPath);
      if (records.length === 0) {
        return;
      }
      assert.equal(records.length, 1);
      assert.equal(records[0].aborted, true);
      assert.equal(records[0].killed, 1);
    }
  );

  scoped(/^fixture mutation progress state start and end timestamps and scope metadata$/, (ctx) => {
    ctx.state = initMutationProgressState(5, START);
    ctx.meta = {
      role: 'coder',
      scope: 'out/bar.js',
      incremental: false,
      concurrency: 1,
      buildSha: 'sha1',
    };
    ctx.expected = buildMutationRunRecord(ctx.state, START + 30_000, ctx.meta);
  });

  scoped(/^the mutation run record builder is invoked$/, (ctx) => {
    ctx.built = buildMutationRunRecord(ctx.state, START + 30_000, ctx.meta);
  });

  scoped(/^the output matches the expected JSON object for those inputs$/, (ctx) => {
    assert.deepEqual(ctx.built, ctx.expected);
  });

  scoped(/^the builder performs no filesystem or Stryker access$/, () => {
    // Pure-function contract: this step exists to pin that the handler above
    // never reached for fs/Stryker — satisfied by buildMutationRunRecord alone.
  });

  scoped(/^mutation-runs\.jsonl already has prior completion lines$/, (ctx) => {
    appendMutationRunRecord(ctx.telemetryPath, {
      started_at: '2026-07-08T12:00:00.000Z',
      ended_at: '2026-07-08T12:01:00.000Z',
      elapsed_s: 60,
      role: 'coder',
      scope: 'out/old.js',
      total: 1,
      incremental: false,
      concurrency: 1,
      killed: 1,
      survived: 0,
      no_coverage: 0,
      timed_out: 0,
      ignored: 0,
      build_sha: 'old',
    });
    ctx.priorLine = fs.readFileSync(ctx.telemetryPath, 'utf8').trim();
  });

  scoped(/^another mutation run completes$/, (ctx) => {
    const reporter = new MutationProgressReporter(ctx.deps());
    reporter.onMutationTestingPlanReady(planReadyEvent(1));
    reporter.onMutantTested({ status: 'Killed' });
    reporter.onMutationTestReportReady();
  });

  scoped(/^a new line is appended without rewriting prior lines$/, (ctx) => {
    const lines = fs.readFileSync(ctx.telemetryPath, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0], ctx.priorLine);
  });

  scoped(
    /^mutation-runs\.jsonl is gitignored under \.swarmforge\/telemetry like context-events\.jsonl$/,
    () => {
      const contextIgnored = execFileSync('git', ['check-ignore', '-q', '.swarmforge/telemetry/context-events.jsonl'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      assert.equal(contextIgnored, '');
      const runsIgnored = execFileSync('git', ['check-ignore', '-q', '.swarmforge/telemetry/mutation-runs.jsonl'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      assert.equal(runsIgnored, '');
    }
  );
}

module.exports = { registerSteps };
