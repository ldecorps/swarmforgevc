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

// BL-964 hardening (hardender, 2026-08-20): the three names above are the
// ones the 2026-08-20 incident happened to expose. swarm_ensure.bb actually
// reads ELEVEN SWARM_ENSURE_* seams, so a hand-written roster of three gated
// 3 of 11: a fake exported as SWARMFORGE_ENSURE_BABYSITTERD_CMD (or
// CURSOR_BRIDGE / FRONT_DESK / OPERATOR / RC_*) was ignored exactly as the
// retired extension names were, the real command ran, and the gate said
// nothing. Measured before this change: 8 of 9 retired spellings missed.
//
// A roster patched one name at a time is the shape this ticket exists to end,
// so the needle set is DERIVED from swarm_ensure.bb's own reads instead - the
// same read-the-other-side's-literal method BL-948's parity gate uses. A
// twelfth seam is covered the day it is added, with no edit here.
const SWARM_ENSURE_LIB = ['swarmforge', 'scripts', 'swarm_ensure.bb'];

// `SWARM_ENSURE_EXTENSION_CHECK_CMD` -> `SWARMFORGE_ENSURE_EXTENSION_CHECK`.
// The trailing _CMD is dropped so the needle matches both the full retired
// name and a bare one, which is why the three literals above are spelled
// that way; a seam with no _CMD suffix is carried whole.
function retiredSpellingOf(realName) {
  const suffix = realName.replace(/^SWARM_ENSURE_/, '').replace(/_CMD$/, '');
  return `SWARMFORGE_ENSURE_${suffix}`;
}

function deriveRetiredEnsureEnvVars(repoRoot) {
  const libPath = path.join(repoRoot, ...SWARM_ENSURE_LIB);
  const source = fs.readFileSync(libPath, 'utf8');
  const real = [...new Set(source.match(/\bSWARM_ENSURE_[A-Z_]+/g) || [])];
  if (real.length === 0) {
    // An empty needle set would pass every file silently - the one failure
    // this gate must never have. Loud, not lenient.
    throw new Error(
      `retiredEnsureEnvVarGuard: found no SWARM_ENSURE_* names in ${libPath}. If those seams ` +
        'were renamed, follow them here - never let the needle set fall empty, which would ' +
        'make this gate pass everything while looking green.'
    );
  }
  // Union with the historical floor: a rename on the .bb side can extend the
  // gate but must never shrink it below the three names known to have caused
  // a real incident.
  return [...new Set([...real.map(retiredSpellingOf), ...RETIRED_ENSURE_ENV_VARS])].sort();
}

const REPO_ROOT_FROM_HERE = path.join(__dirname, '..', '..', '..');

let cachedNeedles = null;
function retiredNeedles(repoRoot = REPO_ROOT_FROM_HERE) {
  if (repoRoot === REPO_ROOT_FROM_HERE) {
    if (!cachedNeedles) cachedNeedles = deriveRetiredEnsureEnvVars(repoRoot);
    return cachedNeedles;
  }
  return deriveRetiredEnsureEnvVars(repoRoot);
}

// The directories the operator directive names, relative to the repo root.
const GUARDED_DIRS = ['specs/pipeline/steps', 'swarmforge/scripts/test'];

function scanFileForRetiredEnsureVars(filePath, text, needles = retiredNeedles()) {
  const violations = [];
  for (const needle of needles) {
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
  deriveRetiredEnsureEnvVars,
  retiredNeedles,
  retiredSpellingOf,
  GUARDED_DIRS,
  scanFileForRetiredEnsureVars,
  scanDirForRetiredEnsureVars,
  scanTreeForRetiredEnsureVars,
};
