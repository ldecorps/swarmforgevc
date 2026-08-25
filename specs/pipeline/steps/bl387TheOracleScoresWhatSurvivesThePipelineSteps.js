'use strict';

// BL-387 (epic BL-384, slice 3): step handlers for "a model is scored on
// the diff that survives the pipeline, not on its first diff". Drives the
// REAL compiled runTrial (extension/out/benchmark/runTrial.js) against the
// REAL pinned fixture (extension/test/fixtures/benchmark/coder-task-01)
// and the REAL node:test evaluator - the same "fake only the genuinely
// external boundary" posture roleBenchmarkHarnessSteps.js already
// established for this same harness. The ONLY faked ports here are the
// ModelExecutor (an LLM actually running) and the PipelineOracle (an LLM
// actually reviewing) - per the ticket's own explicit trap warning, no
// real swarm/tmux/agents are ever stood up in this suite.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const FIXTURE_DIR = path.join(EXT_DIR, 'test', 'fixtures', 'benchmark', 'coder-task-01');

const { loadTaskSpec } = require(path.join(EXT_DIR, 'out', 'benchmark', 'taskFixture'));
const { createNodeTestQualityEvaluator } = require(path.join(EXT_DIR, 'out', 'benchmark', 'nodeTestQualityEvaluator'));
const { runTrial } = require(path.join(EXT_DIR, 'out', 'benchmark', 'runTrial'));

const FULL_SOLUTION_SRC = `'use strict';
function wordFrequency(text) {
  const counts = {};
  const matches = (text || '').match(/[a-zA-Z]+/g) || [];
  for (const raw of matches) {
    const word = raw.toLowerCase();
    counts[word] = (counts[word] || 0) + 1;
  }
  return counts;
}
module.exports = { wordFrequency };
`;

// Deliberately omits .toLowerCase() - passes the fixture's letter/separator
// tests but fails its case-insensitivity tests (4 of 6 -> quality 0.667).
// This is what "the model first produced" in scenario 02.
const PARTIAL_SOLUTION_SRC = `'use strict';
function wordFrequency(text) {
  const counts = {};
  const matches = (text || '').match(/[a-zA-Z]+/g) || [];
  for (const word of matches) {
    counts[word] = (counts[word] || 0) + 1;
  }
  return counts;
}
module.exports = { wordFrequency };
`;

function mkTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function survivingOracle(bounces = 0) {
  return { async review() { return { survived: true, bounces }; } };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a model has produced a diff for a benchmark task$/, (ctx) => {
    ctx.task = loadTaskSpec(FIXTURE_DIR);
    ctx.model = { id: 'model-a', provider: 'claude', model: 'fake' };
    ctx.reviewCalls = 0;
    ctx.deps = {
      executor: {
        async execute(prompt, cwd) {
          fs.writeFileSync(path.join(cwd, 'src', 'wordFrequency.js'), FULL_SOLUTION_SRC);
          return { success: true, costUsd: 0.01, tokens: { inputTokens: 10, outputTokens: 10 }, durationMs: 10 };
        },
      },
      evaluator: createNodeTestQualityEvaluator(),
      // Counts calls unconditionally (not just for scenario 01's own Then)
      // so "was the diff actually put through review" is always an honest
      // assertion, never inferred from a successful outcome - a scenario
      // whose own Given overrides ctx.deps.oracle simply stops adding to
      // this count from that point on.
      oracle: {
        async review(diffDir, task) {
          ctx.reviewCalls += 1;
          return { survived: true, bounces: 0 };
        },
      },
      scratchRoot: mkTmp('aps-bl387-scratch-'),
    };
  });

  // ── shared When ──────────────────────────────────────────────────────
  registry.define(/^the benchmark judges the diff$/, async (ctx) => {
    ctx.run = await runTrial(ctx.task, ctx.model, 1, ctx.deps);
  });

  // ── the-oracle-scores-what-survives-the-pipeline-01 ─────────────────
  registry.define(/^the diff is put through the pipeline's review stages$/, (ctx) => {
    if (ctx.reviewCalls !== 1) {
      throw new Error(`expected the diff to be reviewed exactly once, got ${ctx.reviewCalls} review call(s)`);
    }
  });

  // ── the-oracle-scores-what-survives-the-pipeline-02 ─────────────────
  registry.define(/^the pipeline changed the diff before accepting it$/, (ctx) => {
    // The model's own diff is the PARTIAL (case-sensitive) solution - if
    // scored as-is it would pass only 4 of 6 tests. The oracle REVISES it
    // to the full solution before accepting, mirroring a real review
    // stage fixing something it found.
    ctx.deps.executor = {
      async execute(prompt, cwd) {
        fs.writeFileSync(path.join(cwd, 'src', 'wordFrequency.js'), PARTIAL_SOLUTION_SRC);
        return { success: true, costUsd: 0.01, tokens: { inputTokens: 10, outputTokens: 10 }, durationMs: 10 };
      },
    };
    ctx.deps.oracle = {
      async review(diffDir) {
        fs.writeFileSync(path.join(diffDir, 'src', 'wordFrequency.js'), FULL_SOLUTION_SRC);
        return { survived: true, bounces: 1 };
      },
    };
  });

  registry.define(/^the model is scored on what the pipeline accepted$/, (ctx) => {
    if (ctx.run.testsPassed !== 6 || ctx.run.testsTotal !== 6) {
      throw new Error(`expected the score to reflect the PIPELINE-ACCEPTED (full) solution (6/6), got: ${JSON.stringify(ctx.run)}`);
    }
  });

  registry.define(/^the model is not scored on the diff it first produced$/, (ctx) => {
    // The partial solution the model actually wrote scores 4/6 - proving
    // the recorded score is NOT that confirms the pipeline's revision, not
    // the model's own original output, was what got scored.
    if (ctx.run.testsPassed === 4) {
      throw new Error('expected the score to differ from the model\'s own first-produced (partial) solution\'s 4/6');
    }
  });

  // ── the-oracle-scores-what-survives-the-pipeline-03 (Scenario Outline) ─
  registry.define(/^the pipeline bounced the diff (\d+) times before accepting it$/, (ctx, bouncesRaw) => {
    ctx.deps.oracle = survivingOracle(Number(bouncesRaw));
  });

  registry.define(/^the trial records (\d+) rounds of rework$/, (ctx, bouncesRaw) => {
    const expected = Number(bouncesRaw);
    if (ctx.run.reworkRounds !== expected) {
      throw new Error(`expected ${expected} rounds of rework recorded, got: ${ctx.run.reworkRounds}`);
    }
  });

  // ── the-oracle-scores-what-survives-the-pipeline-04 ─────────────────
  registry.define(/^the pipeline never accepted the diff$/, (ctx) => {
    ctx.deps.oracle = { async review() { return { survived: false, bounces: 2 }; } };
  });

  registry.define(/^the trial records that the diff did not survive$/, (ctx) => {
    if (ctx.run.survived !== false) {
      throw new Error(`expected survived:false, got: ${JSON.stringify(ctx.run)}`);
    }
  });

  registry.define(/^the model is not credited with having solved the task$/, (ctx) => {
    if (ctx.run.qualityScore !== 0 || ctx.run.testsPassed !== 0 || ctx.run.testsTotal !== 0) {
      throw new Error(`expected no credit (qualityScore 0, no tests counted) for a diff that never survived, got: ${JSON.stringify(ctx.run)}`);
    }
  });
}

module.exports = { registerSteps };
