#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { runPipeline } = require('./runnerAdapter');

function usage() {
  process.stderr.write('usage: cli.js <feature-file> [outDir] [stepsModulePath]\n');
}

async function main(argv) {
  const [featureFile, outDir, stepsModulePath] = argv;
  if (!featureFile) {
    usage();
    return 2;
  }
  const resolvedOutDir = path.resolve(outDir || path.join(__dirname, 'generated'));
  const resolvedStepsPath = path.resolve(stepsModulePath || path.join(__dirname, 'steps', 'index.js'));

  const result = await runPipeline(path.resolve(featureFile), resolvedOutDir, resolvedStepsPath);
  process.stdout.write(result.output);
  return result.success ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`${err.stack || err.message || err}\n`);
      process.exit(1);
    });
}

module.exports = { main };
