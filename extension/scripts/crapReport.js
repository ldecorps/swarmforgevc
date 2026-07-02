#!/usr/bin/env node
// BL-049: CRAP metric report for the hardener. Run `npm run crap` (which
// first regenerates coverage via `npm run coverage`), or pass explicit
// files for a differential run, mirroring Stryker's own --mutate pattern:
//   node scripts/crapReport.js src/panel/badgeSummary.ts
//
// Reports complexity, coverage, and CRAP per function over the changed/new
// TypeScript source. Exits non-zero when any function exceeds CRAP 6, so
// the hardener can drive it down before the parcel moves on.
const fs = require('fs');
const path = require('path');
const {
  computeCrap,
  isFlagged,
  extractFunctions,
  parseSource,
  statementCoverageFraction,
} = require('./crapLib');

const CRAP_THRESHOLD = 6;
const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DEFAULT_COVERAGE_PATH = path.join(ROOT_DIR, 'coverage', 'coverage-final.json');

function walkTsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function resolveTargets(args) {
  if (args.length > 0) {
    return args.map((f) => path.resolve(f));
  }
  return walkTsFiles(SRC_DIR);
}

function loadCoverage(coveragePath) {
  if (!fs.existsSync(coveragePath)) {
    console.error(`No coverage report found at ${coveragePath}. Run "npm run coverage" first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
}

function reportFor(absFile, coverage) {
  const sourceText = fs.readFileSync(absFile, 'utf8');
  const sourceFile = parseSource(absFile, sourceText);
  const fileCoverage = coverage[absFile];
  return extractFunctions(sourceFile).map((fn) => {
    const cov = statementCoverageFraction(fileCoverage, fn.startLine, fn.endLine);
    const crap = computeCrap(fn.complexity, cov);
    return {
      file: path.relative(ROOT_DIR, absFile),
      function: fn.name,
      complexity: fn.complexity,
      coverage: cov,
      crap,
      flagged: isFlagged(crap, CRAP_THRESHOLD),
    };
  });
}

function main() {
  const targets = resolveTargets(process.argv.slice(2));
  const coverage = loadCoverage(DEFAULT_COVERAGE_PATH);

  const rows = targets
    .filter((file) => fs.existsSync(file))
    .flatMap((file) => reportFor(file, coverage))
    .sort((a, b) => b.crap - a.crap);

  for (const row of rows) {
    const marker = row.flagged ? '  *** CRAP > 6 ***' : '';
    console.log(
      `${row.file}\t${row.function}\tcomplexity=${row.complexity}\tcoverage=${Math.round(row.coverage * 100)}%\tCRAP=${row.crap.toFixed(2)}${marker}`
    );
  }

  const flaggedCount = rows.filter((r) => r.flagged).length;
  if (flaggedCount > 0) {
    console.error(`\n${flaggedCount} function(s) exceed the CRAP <= ${CRAP_THRESHOLD} threshold.`);
    process.exit(1);
  }
}

main();
