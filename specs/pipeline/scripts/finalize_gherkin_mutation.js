#!/usr/bin/env node
'use strict';

// BL-638: called by run_gherkin_mutation.sh AFTER the vendored, pinned
// gherkin-mutator has returned. Reads the vendored CLI's captured `--json`
// stdout, classifies the outcome, corrects the feature file's embedded
// manifest/stamp when nothing was ever discovered to mutate, re-emits the
// (possibly annotated) JSON report, and exits with the outcome's own exit
// code. Thin wrapper: all decision logic lives in gherkinMutationOutcome.js.
//
// Usage: finalize_gherkin_mutation.js <feature-file> <bb-exit-code>
//   stdin: the vendored CLI's captured stdout (its --json report)

const fs = require('node:fs');
const { classifyOutcome, exitCodeFor, markManifestInapplicable } = require('../gherkinMutationOutcome');

function main(argv, io) {
  const featurePath = argv[2];
  const bbExit = Number.parseInt(argv[3], 10) || 0;
  const raw = io.readStdin();

  let report;
  try {
    report = JSON.parse(raw);
  } catch (e) {
    // Not a JSON report at all (bad args / an infrastructure crash before
    // the vendored CLI ever produced one) - relay exactly what it printed
    // and its own exit code, unmodified.
    io.write(raw);
    return io.exit(bbExit);
  }

  const outcome = classifyOutcome(report.summary);
  if (outcome === 'inapplicable') {
    io.writeFile(featurePath, markManifestInapplicable(io.readFile(featurePath)));
  }
  report.outcome = outcome;
  io.write(JSON.stringify(report, null, 2) + '\n');
  return io.exit(exitCodeFor(outcome));
}

if (require.main === module) {
  main(process.argv, {
    readStdin: () => fs.readFileSync(0, 'utf8'),
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    writeFile: (p, content) => fs.writeFileSync(p, content),
    write: (s) => process.stdout.write(s),
    exit: (code) => process.exit(code),
  });
}

module.exports = { main };
