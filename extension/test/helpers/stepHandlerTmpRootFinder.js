'use strict';

// BL-1636: the pure finder the standing guard (stepHandlerTmpRootGuard.test.js)
// drives - the same shape rawMkdtempGuard.js's findRawMkdtempCallSites uses
// for BL-420's migration-complete gate. A step handler under
// specs/pipeline/steps/*Steps.js that calls fs.mkdtempSync and registers
// none of the recognised cleanup mechanisms leaks its root on every
// scenario run (fixtureReaper.js's `track`/`trackedTmpRoot`/`onAbnormalExit`,
// or a recognised sweep helper call) - an offender.
const fs = require('fs');
const path = require('path');

const MKDTEMP_PATTERN = /\bmkdtempSync\s*\(/;

// Any one of these appearing in the file's text is treated as registration -
// deliberately text-level (not an AST check): the handler tree is 1191
// files of hand-written JS with no shared import convention beyond
// `require`, and a text scan is what BL-420's own finder already proved
// sufficient for this exact class of gate.
const REGISTRATION_MARKERS = [
  /require\([^)]*fixtureReaper[^)]*\)/,
  /\btrack\s*\(/,
  /\btrackedTmpRoot\s*\(/,
  /\bonAbnormalExit\s*\(/,
  /\bsweepStaleFixtures\s*\(/,
  /\bsweepStaleTmpDirs\s*\(/,
  /\bmkTmpDir\s*\(/,
];

function isRegistered(text) {
  return REGISTRATION_MARKERS.some((re) => re.test(text));
}

/**
 * BL-1636: scans stepsDir (non-recursive by default - specs/pipeline/steps'
 * own handlers live flat at its top level; lib/ helpers are a different
 * population, required BY handlers rather than being one) for *.js files
 * whose text calls mkdtempSync without a recognised registration. Returns
 * relative (to stepsDir) file paths, sorted - the same shape a committed
 * census file line-per-offender expects.
 */
function findStepHandlerTmpRootOffenders(stepsDir) {
  const offenders = [];
  for (const entry of fs.readdirSync(stepsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) {
      continue;
    }
    const full = path.join(stepsDir, entry.name);
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        continue;
      }
      throw err;
    }
    if (MKDTEMP_PATTERN.test(text) && !isRegistered(text)) {
      offenders.push(entry.name);
    }
  }
  return offenders.sort();
}

module.exports = { findStepHandlerTmpRootOffenders, MKDTEMP_PATTERN, REGISTRATION_MARKERS };
