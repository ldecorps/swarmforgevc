'use strict';

// BL-1623: the one place "does this property file blindly list the whole
// temp dir" is decided - the unit-lane guard (blindTmpDirSweepGuard.test.js)
// and the acceptance step handler (bl1623ScopedTmpDirSweepSteps.js) both
// need the identical answer, so neither hand-rolls its own copy of the scan.
const fs = require('fs');
const path = require('path');

// A literal `readdirSync(os.tmpdir())` call is exactly BL-1385/BL-1390's
// blind-sweep shape this ticket retires; the scoped helper (tmpDir.js's
// sweepStaleTmpDirs) never appears as this literal, since it reads its own
// `dir` parameter, not a `os.tmpdir()` call inline - no allowlist needed.
const BLIND_CALL_PATTERN = /readdirSync\(\s*os\.tmpdir\(\)\s*\)/;

// Non-recursive, `*.property.test.js` only - the census this ticket names
// is exactly that population (BL-1445).
function findBlindTmpDirSweeps(dir) {
  const offenders = [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return offenders;
  }
  for (const name of names) {
    if (!name.endsWith('.property.test.js')) {
      continue;
    }
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    if (BLIND_CALL_PATTERN.test(text)) {
      offenders.push(name);
    }
  }
  return offenders.sort();
}

module.exports = { findBlindTmpDirSweeps, BLIND_CALL_PATTERN };
