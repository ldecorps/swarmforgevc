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

// BL-1677: the same blind sweep, one step removed through a local alias -
// `const parent = os.tmpdir();` then `readdirSync(parent)` elsewhere in the
// file (bl1354/bl1389/bl1380's own pre-migration shape). Matched as two
// separate scans rather than one combined regex: the binding and the read
// can be arbitrarily far apart in the file, and a single identifier may be
// bound more than once, so each `<const|let|var> <ident> = os.tmpdir()`
// binding is checked against every `readdirSync(<ident>)` call in the whole
// text. `const|let|var`, not `const` alone - invariant 2's own wording is
// "through a variable", and a `let`/`var` alias is exactly as blind as a
// `const` one (verified: a `let tmp = os.tmpdir(); ... readdirSync(tmp)`
// fixture returned undetected before this widening).
const ALIAS_BINDING_PATTERN = /(?:const|let|var)\s+(\w+)\s*=\s*os\.tmpdir\(\)/g;

function hasAliasedBlindSweep(text) {
  for (const match of text.matchAll(ALIAS_BINDING_PATTERN)) {
    const ident = match[1];
    const readPattern = new RegExp(`readdirSync\\(\\s*${ident}\\s*\\)`);
    if (readPattern.test(text)) {
      return true;
    }
  }
  return false;
}

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
    if (BLIND_CALL_PATTERN.test(text) || hasAliasedBlindSweep(text)) {
      offenders.push(name);
    }
  }
  return offenders.sort();
}

module.exports = { findBlindTmpDirSweeps, BLIND_CALL_PATTERN };
