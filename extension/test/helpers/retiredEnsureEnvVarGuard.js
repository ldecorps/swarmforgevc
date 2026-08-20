'use strict';

// BL-964: the retired SWARMFORGE_ENSURE_* env-var names must never reappear
// in test code. swarm_ensure.bb reads SWARM_ENSURE_EXTENSION_CHECK_CMD /
// SWARM_ENSURE_EXTENSION_BOUNCE_CMD / SWARM_ENSURE_SUPERVISOR_CMD; a fake
// exported under the retired spelling is silently ignored and the REAL
// extension bounce runs - on 2026-08-20 two VS Code Extension Development
// Host windows opened unprompted from test runs exactly this way (human
// hotfix 596098dc3). The failure is soft (the test still passes), so only
// a standing gate can keep the class from recurring.
//
// The needles are the FULL retired names, never the bare prefix - main
// legitimately carries explanatory "SWARMFORGE_ENSURE_*" comment mentions,
// and a bare-prefix grep would trip on them. This module lives OUTSIDE the
// grepped directories (extension/test/helpers/), so it is the one place
// allowed to spell the literals; the BL-964 step handlers (which live in a
// grepped directory) build them from split parts at runtime.

const fs = require('node:fs');
const path = require('node:path');

const RETIRED_ENSURE_ENV_VARS = [
  'SWARMFORGE_ENSURE_EXTENSION_CHECK',
  'SWARMFORGE_ENSURE_EXTENSION_BOUNCE',
  'SWARMFORGE_ENSURE_SUPERVISOR',
];

// The directories the operator directive names, relative to the repo root.
const GUARDED_DIRS = ['specs/pipeline/steps', 'swarmforge/scripts/test'];

function scanFileForRetiredEnsureVars(filePath, text) {
  const violations = [];
  for (const needle of RETIRED_ENSURE_ENV_VARS) {
    if (text.includes(needle)) {
      violations.push({ file: filePath, retired: needle });
    }
  }
  return violations;
}

function scanDirForRetiredEnsureVars(dir) {
  const violations = [];
  if (!fs.existsSync(dir)) return violations;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      violations.push(...scanDirForRetiredEnsureVars(full));
    } else if (entry.isFile()) {
      violations.push(...scanFileForRetiredEnsureVars(full, fs.readFileSync(full, 'utf8')));
    }
  }
  return violations;
}

function scanTreeForRetiredEnsureVars(repoRoot) {
  return GUARDED_DIRS.flatMap((rel) => scanDirForRetiredEnsureVars(path.join(repoRoot, rel)));
}

module.exports = {
  RETIRED_ENSURE_ENV_VARS,
  GUARDED_DIRS,
  scanFileForRetiredEnsureVars,
  scanDirForRetiredEnsureVars,
  scanTreeForRetiredEnsureVars,
};
