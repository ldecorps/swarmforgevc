#!/usr/bin/env node
// BL-221/BL-267: run before `stryker run` (wired into the "mutation" npm
// script) so the sandboxed dry run can resolve every repo-root sibling a
// test or the code under test reaches into, instead of ENOENT-ing. See
// strykerSandboxSiblingsLib.js for why a single shared symlink per sibling
// at .stryker-tmp/<name> - never a per-sandbox copy - is the right shape.
const path = require('path');
const { ensureStrykerSandboxSiblingLinks } = require('./strykerSandboxSiblingsLib');

const EXTENSION_DIR = path.join(__dirname, '..');
const TEMP_DIR_NAME = '.stryker-tmp'; // must match stryker.config.json's tempDirName

// Every repo-root sibling a test or the code under test resolves a runtime
// path into. Confirmed instances (complete swept set as of BL-918): pwa/
// (BL-221, asset reads), swarmforge/ (BL-267, complianceBatteryGate.ts
// shelling compliance_battery.bb), .github/ (BL-267,
// backlogDashboardWorkflowCacheStamp.test.js reading
// .github/workflows/backlog-dashboard.yml), docs/ (BL-267,
// gettingStartedDrift.test.js reading docs/tutorials/GettingStarted.md),
// specs/ (BL-918 hardening, bl884GherkinMutationRunnerArgValidation.test.js
// spawning specs/pipeline/scripts/run_gherkin_mutation.sh - without this the
// sandboxed dry run can't exec the script at all and every BL-884 assertion
// on its exit code fails, e.g. expecting 3 and observing bash's 127), and
// backlog/ (BL-1441: extension/test/helpers/stampOff.js's findTicketYaml
// recursively scans REPO_ROOT/backlog/ - masked until now because every
// full-suite mutation dry run since bl1356StampOffHelper.test.js landed was
// blocked earlier, by cooldown or the constitutionDocCitations red, before
// reaching this test; ENOENT scandir '.stryker-tmp/backlog' the moment one
// finally got this far). Adding coverage for a new sibling is adding its
// name here.
const SIBLING_NAMES = ['pwa', 'swarmforge', '.github', 'docs', 'specs', 'backlog'];

for (const result of ensureStrykerSandboxSiblingLinks(EXTENSION_DIR, TEMP_DIR_NAME, SIBLING_NAMES)) {
  console.log(`${result.created ? 'Created' : 'Verified'} ${result.siblingName}/ sandbox link at ${result.linkPath}`);
}
