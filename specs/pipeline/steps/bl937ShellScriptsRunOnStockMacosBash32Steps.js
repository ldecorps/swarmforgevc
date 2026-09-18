'use strict';

// BL-937: step handlers for "every tracked shell script runs on the stock
// macOS /bin/bash 3.2 this repo targets". Drives the REAL /bin/bash and the
// real scripts - never a reimplementation of any of them.
//
// BL-1627: scenarios 01 and 03 (both `Given the stock system bash reports
// version 3.2`) are RETIRED, not reworded - their premise is the HOST this
// swarm runs on, which was macOS when BL-937 minted this feature and is
// WSL/Linux now; the runtime checks they made live on as macOS-only
// qa_e2e steps instead (never a scenario the acceptance runner tries and
// fails on every non-macOS host). Scenario 02 - the pure static construct
// scan over tracked shell scripts with comment lines excluded - is the one
// remaining scenario and the standing guard; it is unchanged.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'every tracked shell script runs on the stock macOS /bin/bash 3.2 this repo targets';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

// ── Scenario 02: the static construct scan ───────────────────────────────

function trackedShellScripts() {
  const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--', '*.sh'], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .map((rel) => path.join(REPO_ROOT, rel));
}

// Excludes comment lines (first non-whitespace char '#') before scanning -
// this fix's OWN explanatory comments name "mapfile"/"readarray" in prose,
// same shape as lifecycle_matrix.sh's pre-existing "no `declare -A`"
// comment; a scan that read comments would trip on both.
function stripComments(content) {
  return content
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

const CONSTRUCT_REGEXES = {
  'mapfile or readarray': /\b(?:mapfile|readarray)\b/,
  'case-converting parameter expansion': /\$\{\w+(?:\^\^|\^|,,|,)\}/,
};

// swarmforge/scripts/test/test_route_backlog_role_label_bash32.sh's own
// scenario 03 embeds the literal string `${ROLE^}` as TEST DATA inside a
// single-quoted `bash -c '...'` argument, specifically to prove /bin/bash
// 3.x REJECTS it (a pre-existing, already-fixed regression test for
// route_backlog_to_coder.sh's own prior bash-4 usage - read the file, its
// own scenario 01 runs an equivalent scan against JUST that one script).
// The outer script here never evaluates that string itself; it hands it to
// a nested subprocess as a controlled negative case. Excluding this one
// known, well-justified occurrence rather than weakening the general regex
// - the same "known-good, do not trip on it" posture the ticket itself
// applies to lifecycle_matrix.sh's comment, just for a non-comment case
// the comment-stripping filter alone cannot distinguish.
const KNOWN_SAFE_OCCURRENCES = new Set(['swarmforge/scripts/test/test_route_backlog_role_label_bash32.sh']);

function registerSteps(registry) {
  registry.defineScoped(
    /^the repo's tracked shell scripts with comment lines excluded$/,
    (ctx) => {
      ctx.scannedFiles = trackedShellScripts().map((file) => ({
        file,
        content: stripComments(fs.readFileSync(file, 'utf8')),
      }));
    },
    FEATURE
  );

  registry.defineScoped(
    /^they are scanned for (.+)$/,
    (ctx, token) => {
      const regex = CONSTRUCT_REGEXES[token];
      if (!regex) {
        throw new Error(`unknown construct token: ${token}`);
      }
      ctx.hits = ctx.scannedFiles
        .filter(({ content }) => regex.test(content))
        .map(({ file }) => path.relative(REPO_ROOT, file))
        .filter((rel) => !KNOWN_SAFE_OCCURRENCES.has(rel));
    },
    FEATURE
  );

  registry.defineScoped(
    /^no occurrence is found$/,
    (ctx) => {
      assert.deepEqual(ctx.hits, [], `expected no tracked shell script to contain this construct outside comments, found: ${JSON.stringify(ctx.hits)}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
