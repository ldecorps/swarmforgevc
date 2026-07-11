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
// path into. Confirmed instances: pwa/ (BL-221, asset reads), swarmforge/
// (BL-267, complianceBatteryGate.ts shelling compliance_battery.bb), and
// .github/ (BL-267 verification pass, backlogDashboardWorkflowCacheStamp.test.js
// reading .github/workflows/backlog-dashboard.yml). Adding coverage for a
// new sibling is adding its name here.
const SIBLING_NAMES = ['pwa', 'swarmforge', '.github'];

for (const result of ensureStrykerSandboxSiblingLinks(EXTENSION_DIR, TEMP_DIR_NAME, SIBLING_NAMES)) {
  console.log(`${result.created ? 'Created' : 'Verified'} ${result.siblingName}/ sandbox link at ${result.linkPath}`);
}
