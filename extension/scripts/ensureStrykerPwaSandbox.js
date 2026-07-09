#!/usr/bin/env node
// BL-221: run before `stryker run` (wired into the "mutation" npm script)
// so the sandboxed dry run's tests can resolve sibling pwa/ assets instead
// of ENOENT-ing. See strykerPwaSandboxLib.js for why a single shared
// symlink at .stryker-tmp/pwa - not a per-sandbox copy - is the right shape.
const path = require('path');
const { ensureStrykerPwaSandboxLink } = require('./strykerPwaSandboxLib');

const EXTENSION_DIR = path.join(__dirname, '..');
const TEMP_DIR_NAME = '.stryker-tmp'; // must match stryker.config.json's tempDirName

const result = ensureStrykerPwaSandboxLink(EXTENSION_DIR, TEMP_DIR_NAME);
console.log(`${result.created ? 'Created' : 'Verified'} pwa/ sandbox link at ${result.linkPath}`);
