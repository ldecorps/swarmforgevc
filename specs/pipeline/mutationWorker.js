#!/usr/bin/env node
'use strict';

// BL-113: the long-lived --runner-worker process gherkin-mutator
// (swarmforge/vendor/aps/bb/src/aps/cli/gherkin_mutator.clj) spawns and
// drives over newline-delimited JSON on stdio - one
// {id, feature_json, generated_dir, work_dir} request per mutant, one
// {id, outcome, output, error} response each, per aps.mutation/run-worker-job
// and aps.mutation/make-result's own outcome mapping:
//   "test_failure" -> mutant KILLED (the generated test caught the mutated
//     example value - it IS load-bearing)
//   "test_success" -> mutant SURVIVED (the test still passed despite the
//     mutated value - a real gap: that example data isn't actually asserted)
//   "infrastructure_error" -> something broke running the harness itself,
//     not a real mutation signal
//
// feature_json is already a mutated IR (same shape gherkin-parser produces -
// aps.mutation writes it via the same aps.gherkin/write-json!), so this
// reuses the existing feature->entry-points->run chain (generate.js/
// runnerAdapter.js) exactly as a normal acceptance run does - no
// reimplementation, just a different entry point (an IR object already in
// hand, not a .feature file needing gherkin-parser first).

const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');
const { writeEntryPoints } = require('./generate');
const { runGeneratedTests } = require('./runnerAdapter');

function handle(request, stepsModulePath) {
  const { id, feature_json: featureJsonPath, work_dir: workDir } = request;
  try {
    const feature = JSON.parse(fs.readFileSync(featureJsonPath, 'utf8'));
    const outDir = path.join(workDir, 'generated');
    const generatedPath = writeEntryPoints(feature, outDir, { stepsModulePath });
    const result = runGeneratedTests([generatedPath]);
    if (result.timedOut) {
      // BL-1358, invariant 1. A mutant that never finished is reported as its
      // OWN outcome, named with the ceiling it exceeded - never folded into
      // test_failure (which would claim the tests DETECTED it) nor into
      // test_success (which would claim it survived a test that actually
      // ran). `infrastructure_error` is the report's third bucket: it lands in
      // the summary's Errors, which gherkinMutationClassify already fails the
      // gate on - the human's ruling option 1, a timed-out mutant failing the
      // gate the same as a surviving one, with no change to the classifier and
      // no new outcome string the pinned vendored mutator would not understand.
      return {
        id,
        outcome: 'infrastructure_error',
        timed_out: true,
        error:
          `mutant ${id} exceeded the ${result.timeoutMs} ms per-mutant ceiling and was killed ` +
          '(SIGKILL to its whole process group). It was neither detected nor shown to survive: ' +
          'nothing about its scenario was proven, and this run reports it as timed out. ' +
          'Raise GHERKIN_MUTATION_TIMEOUT_MS if the scenario is legitimately slower than the ceiling.',
        output: result.output,
      };
    }
    return {
      id,
      outcome: result.success ? 'test_success' : 'test_failure',
      output: result.output,
    };
  } catch (err) {
    return {
      id,
      outcome: 'infrastructure_error',
      error: err.stack || err.message || String(err),
    };
  }
}

function main(argv) {
  const stepsModulePath = path.resolve(argv[0] || path.join(__dirname, 'steps', 'index.js'));
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    if (!line.trim()) {
      return;
    }
    let response;
    try {
      const request = JSON.parse(line);
      response = handle(request, stepsModulePath);
    } catch (err) {
      response = { id: null, outcome: 'infrastructure_error', error: err.stack || err.message || String(err) };
    }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { handle, main };
