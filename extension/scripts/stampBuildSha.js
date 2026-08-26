#!/usr/bin/env node
// BL-328: writes extension/out/BUILD_SHA (the repo's HEAD commit at compile
// time) right after `tsc` finishes (wired as npm's own postcompile hook -
// npm runs it automatically after `npm run compile`, no change to the
// `compile` script itself needed). extension/out/ is gitignored, so a
// running Node process's compiled JS carries no git metadata of its own -
// this file is the ONE place that identity gets stamped, read ONCE at
// process startup by each long-lived entrypoint (never re-read live, which
// would report the CURRENT on-disk build instead of what that process
// actually loaded into memory).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(EXT_DIR, 'out');
const BUILD_SHA_FILE = path.join(OUT_DIR, 'BUILD_SHA');

// Fail-soft: `npm run compile` is a load-bearing step for many OTHER
// scripts (test, coverage, crap, mutation, tracer-bullet) - stamping must
// never be able to break a compile that would otherwise have succeeded
// (e.g. no .git present in some packaged/sandboxed context). A missing
// BUILD_SHA file just means staleness detection can't resolve THIS build's
// identity - handled explicitly downstream, never a crash here.
function main() {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: EXT_DIR, encoding: 'utf8' }).trim();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(BUILD_SHA_FILE, sha + '\n');
  } catch (error) {
    process.stderr.write(`stampBuildSha: could not stamp BUILD_SHA (${error.message}) - continuing\n`);
  }
}

main();
