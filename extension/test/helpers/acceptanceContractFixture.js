'use strict';

// BL-761: the SHARED fixture builder for the pre-QA acceptance-contract gate
// suites (bl531/bl606/bl623 step files all send a git_handoff through
// findings-for-git-handoff, which now also arms the acceptance-contract
// finding). Each of those suites needs its OWN ticket to declare a
// resolvable, fully-covered acceptance: contract at every cited commit it
// sends, purely so the new gate stays silent while the suite exercises
// lineage/wiring/routing instead - written once here rather than
// copy-pasted per file (the original defect this extraction fixes).
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DEFAULT_FEATURE_PATH = 'specs/features/bl900-fixture.feature';
const DEFAULT_FEATURE_TITLE = 'BL-900 fixture contract';
const DEFAULT_STEP_TEXT = 'the fixture step is known';

// Writes a trivial, fully-resolvable step registry (stepRegistry.js and
// runtime.js copied verbatim from this checkout, one step file defining the
// single step the feature file uses) plus the feature file itself and a
// symlink to the vendored APS parser, all under targetPath - the same shape
// resolve_contract_steps.js expects when pre_qa_gate_gather_lib.bb
// materializes a cited commit's specs/pipeline tree for real.
function writeAcceptanceContractFixture(targetPath, opts = {}) {
  const featurePath = opts.featurePath || DEFAULT_FEATURE_PATH;
  const featureTitle = opts.featureTitle || DEFAULT_FEATURE_TITLE;
  const stepText = opts.stepText || DEFAULT_STEP_TEXT;

  fs.mkdirSync(path.join(targetPath, 'specs', 'pipeline', 'steps'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'specs', 'pipeline', 'stepRegistry.js'), path.join(targetPath, 'specs', 'pipeline', 'stepRegistry.js'));
  fs.copyFileSync(path.join(REPO_ROOT, 'specs', 'pipeline', 'runtime.js'), path.join(targetPath, 'specs', 'pipeline', 'runtime.js'));
  fs.writeFileSync(
    path.join(targetPath, 'specs', 'pipeline', 'steps', 'index.js'),
    `'use strict';\nfunction registerSteps(registry) { registry.define(/^${stepText}$/, () => {}); }\nmodule.exports = { registerSteps };\n`
  );

  const featureFullPath = path.join(targetPath, featurePath);
  fs.mkdirSync(path.dirname(featureFullPath), { recursive: true });
  fs.writeFileSync(featureFullPath, `Feature: ${featureTitle}\n\n  Scenario: covered\n    Given ${stepText}\n`);

  fs.mkdirSync(path.join(targetPath, 'swarmforge', 'vendor'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'swarmforge', 'vendor', 'aps'), path.join(targetPath, 'swarmforge', 'vendor', 'aps'), 'dir');

  fs.mkdirSync(path.join(targetPath, 'specs', 'pipeline', 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'resolve_contract_steps.js'),
    path.join(targetPath, 'specs', 'pipeline', 'scripts', 'resolve_contract_steps.js')
  );
}

module.exports = { writeAcceptanceContractFixture, DEFAULT_FEATURE_PATH, DEFAULT_STEP_TEXT };
