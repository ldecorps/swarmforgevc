'use strict';

// BL-1767: reads model_steward_lib.bb's safety-critical-competencies set at
// run time rather than restating it as a literal in each step-handler file.
// A planted compliance-battery scorecard that hand-copies the set (as
// bl547/bl556/bl1079's fixtures did before this ticket) goes stale the next
// time a competency is added there - this is the second time exactly that
// has reddened these fixtures. Reading the lib live means adding a
// competency to the set leaves every caller's planted card green.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const MODEL_STEWARD_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_lib.bb');

let cachedCompetencies = null;

// Real subprocess read of the lib's own set (sorted, matching
// certification-safety-gate's own `(sort safety-critical-competencies)`).
// Memoized: every caller in a given acceptance run wants the same,
// unchanging-within-the-run answer, and this keeps a per-scenario `bb -e`
// spawn from being paid by every scenario that plants a card.
function readSafetyCompetencies() {
  if (cachedCompetencies) return cachedCompetencies;
  const out = execFileSync('bb', [
    '-e',
    `(load-file "${MODEL_STEWARD_LIB}") (doseq [c (sort model-steward-lib/safety-critical-competencies)] (println c))`,
  ], { encoding: 'utf8' });
  cachedCompetencies = out.split('\n').map((line) => line.trim()).filter(Boolean);
  return cachedCompetencies;
}

// Pure: {competency, status: "pass"} for each name, in the given order.
function passingSafetyEntries(competencyNames) {
  return competencyNames.map((competency) => ({ competency, status: 'pass' }));
}

module.exports = { readSafetyCompetencies, passingSafetyEntries };
