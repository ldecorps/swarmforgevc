'use strict';

// BL-874 invariants 1 & 2: "any test that backdates a file's mtime does so
// through one shared portable helper; no test re-implements the BSD/GNU
// split inline" and "a newly added GNU-only relative-time invocation under
// swarmforge/scripts turns a gate red inside the parcel that introduces
// it, not a later one." Mirrors specs/pipeline/steps/lib/tempDirTrapGuard.js's
// shape (BL-459/BL-872): a pure per-file classifier plus a directory walk,
// self-exempting the shared helper file that legitimately contains the GNU
// relative-time syntax as its own fallback implementation.
const fs = require('node:fs');
const path = require('node:path');

// GNU-only relative time: `date -d`/`touch -d` whose quoted argument names
// a relative unit ("2 hours ago", "-5 minutes", "90 seconds ago"). An
// absolute spec (`touch -d "2026-01-01T00:00:00"`, `touch -t 202601010000`)
// works on both BSD and GNU and is not a violation.
const RELATIVE_TIME_INVOCATION = /\b(?:date|touch)\s+-d\s+["'][^"']*\b(?:ago|seconds?|minutes?|hours?|days?|weeks?)\b[^"']*["']/;

const SELF_EXEMPT_BASENAMES = new Set(['portable_time_lib.sh']);

// Pure: given one file's own basename + text, returns a violation reason or
// null. Exported separately from the directory walk so a unit test can
// drive it directly against fixture strings, no filesystem needed.
function findPortableTimeViolation(basename, text) {
  if (SELF_EXEMPT_BASENAMES.has(basename)) {
    return null;
  }
  const match = RELATIVE_TIME_INVOCATION.exec(text);
  if (!match) {
    return null;
  }
  return `backdates a file's mtime with a GNU-only relative-time invocation inline (${match[0].trim()}), not through portable_time_lib.sh's portable_touch_relative`;
}

// Impure: walks swarmforge/scripts (recursively) and returns every violation
// found.
function scanForPortableTimeViolations(scriptsDir) {
  const violations = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.sh') && !entry.name.endsWith('.bb')) {
        continue;
      }
      const text = fs.readFileSync(full, 'utf8');
      const reason = findPortableTimeViolation(entry.name, text);
      if (reason) {
        violations.push({ file: full, reason });
      }
    }
  }

  walk(scriptsDir);
  return violations;
}

module.exports = { findPortableTimeViolation, scanForPortableTimeViolations };
