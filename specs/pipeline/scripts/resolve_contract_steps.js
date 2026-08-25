#!/usr/bin/env node
'use strict';

// BL-761: the JS half of the pre-QA acceptance-contract gate. Takes an
// already-parsed feature IR (produced by the vendored APS parser, same as
// every other acceptance run - runnerAdapter.js's parseFeatureFile) and a
// step-registry tree, and reports which steps resolve - it never runs a
// step handler, only registry.resolve(). pre_qa_gate_gather_lib.bb shells
// out to this script pointed at a step-registry tree it has materialized
// at the ticket's cited commit (git show, not the caller's working tree),
// so `pipelineDir` here is that materialized directory, not necessarily
// this repo's own specs/pipeline/.
//
// Reuse, never reimplement (BL-761 constraint): stepRegistry.js's resolve()
// and runtime.js's substitute()/scenarioSteps() are require()'d from
// pipelineDir and driven exactly as the real acceptance runner drives them
// - this script adds no matching logic of its own.
//
// Usage: node resolve_contract_steps.js <pipelineDir> <featureIrJsonPath>
// Always prints one JSON line to stdout and exits 0 when it could form a
// verdict at all - even a registry that fails to require() is a verdict
// ({loadable:false, error}), not a crash, so the caller never has to
// distinguish "the check ran and found nothing wrong with loading" from
// "the check itself blew up" by parsing exit codes. A nonzero exit means
// this script's OWN inputs (argv, the IR file) were unusable - the
// caller's fail-open path treats that the same as {loadable:false}.

const fs = require('node:fs');
const path = require('node:path');

function readFeatureIr(featureIrJsonPath) {
  return JSON.parse(fs.readFileSync(featureIrJsonPath, 'utf8'));
}

function loadRegistry(pipelineDir) {
  const { createStepRegistry } = require(path.join(pipelineDir, 'stepRegistry.js'));
  const { registerSteps } = require(path.join(pipelineDir, 'steps', 'index.js'));
  const registry = createStepRegistry();
  registerSteps(registry);
  return registry;
}

function loadRuntime(pipelineDir) {
  return require(path.join(pipelineDir, 'runtime.js'));
}

function exampleCases(scenario) {
  if (scenario.examples && scenario.examples.length > 0) {
    return scenario.examples.map((row, index) => ({ exampleIndex: index, row }));
  }
  return [{ exampleIndex: null, row: undefined }];
}

// Every scenario, every Scenario Outline example row, every step -
// substituted then resolved, never executed. Nothing is skipped, sampled,
// or assumed matched (BL-761 invariant 2): a single pass collects every
// unresolved step rather than stopping at the first.
function findUnresolvedSteps(feature, registry, runtime) {
  const unresolved = [];
  for (const scenario of feature.scenarios) {
    for (const { exampleIndex, row } of exampleCases(scenario)) {
      for (const step of runtime.scenarioSteps(feature, scenario)) {
        const stepText = runtime.substitute(step.text, row);
        if (!registry.resolve(stepText, feature.name)) {
          unresolved.push({ scenario: scenario.name, exampleIndex, stepText });
        }
      }
    }
  }
  return unresolved;
}

function main(argv) {
  const [pipelineDir, featureIrJsonPath] = argv;
  if (!pipelineDir || !featureIrJsonPath) {
    process.stderr.write('usage: resolve_contract_steps.js <pipelineDir> <featureIrJsonPath>\n');
    return 2;
  }

  let feature;
  try {
    feature = readFeatureIr(featureIrJsonPath);
  } catch (err) {
    process.stderr.write(`could not read feature IR: ${err.message}\n`);
    return 2;
  }

  try {
    const registry = loadRegistry(pipelineDir);
    const runtime = loadRuntime(pipelineDir);
    const unresolved = findUnresolvedSteps(feature, registry, runtime);
    process.stdout.write(JSON.stringify({ loadable: true, unresolved }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ loadable: false, error: err.message || String(err) }));
  }
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { findUnresolvedSteps, exampleCases };
