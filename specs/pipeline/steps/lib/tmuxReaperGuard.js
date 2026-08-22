'use strict';

// BL-817: the load-bearing "every step handler that starts a fixture tmux
// server adopts the shared fixtureReaper" check - mirrors
// tempDirTrapGuard.js's own shape (BL-459) for the temp-dir-trap concern,
// applied to the sibling tmux-server-leak concern this ticket closes. A
// step handler with terminal-step-only inline cleanup leaks its server the
// moment a mutant fails early, or the runner is killed, before reaching
// that cleanup - fixtureReaper.js's track()/reap() already cover both
// (BL-458); this guard is what keeps the idiom from returning a seventh
// time (it already had, once, at BL-807's own file - discovered and fixed
// in the same parcel that built this guard).
//
// Scope is specs/pipeline/steps/*.js ONLY - the ticket's own wording, and
// deliberately non-recursive: lib/ holds fixtureReaper.js itself and its
// own abnormal-exit test harness (which legitimately calls track()
// directly, not as a step handler), never a step file a acceptance run
// would register.
//
// Detection is FILE-LEVEL, not per-call-site (the same trust boundary
// tempDirTrapGuard.js draws): a file that starts a tmux server (a quoted
// 'new-session' token, the literal argv element every real starter in this
// repo uses) must ALSO require fixtureReaper and call track() somewhere -
// a file that does both is trusted to have wired them together correctly,
// the same trust tempDirTrapGuard.js extends to a shell trap or a bb
// try/finally.
const fs = require('node:fs');
const path = require('node:path');

// Quoted so a substring match inside an unrelated string (an HTTP path
// like /lets-talk/new-session, a data-testid, or prose in an error message)
// never false-positives - every real tmux-server starter in this repo
// passes 'new-session' as its own argv array element, quoted exactly like
// this.
const STARTS_TMUX_SERVER = /['"]new-session['"]/;
const REQUIRES_FIXTURE_REAPER = /require\(\s*['"]\.\/lib\/fixtureReaper['"]\s*\)/;
const CALLS_TRACK = /\btrack\s*\(/;

// Pure: given one file's own basename + text, returns a violation reason or
// null. Exported separately from the directory walk so a unit/property
// test can drive it directly against fixture strings, no filesystem needed.
function findTmuxReaperViolation(basename, text) {
  if (!STARTS_TMUX_SERVER.test(text)) {
    return null;
  }
  if (REQUIRES_FIXTURE_REAPER.test(text) && CALLS_TRACK.test(text)) {
    return null;
  }
  return "starts a tmux server ('new-session') but does not require ./lib/fixtureReaper and call track()";
}

// Impure: reads every specs/pipeline/steps/*.js file (top-level only, never
// recursing into lib/ or test/) and returns every violation found.
function scanForTmuxReaperViolations(stepsDir) {
  const violations = [];
  for (const entry of fs.readdirSync(stepsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) {
      continue;
    }
    const full = path.join(stepsDir, entry.name);
    const text = fs.readFileSync(full, 'utf8');
    const reason = findTmuxReaperViolation(entry.name, text);
    if (reason) {
      violations.push({ file: full, reason });
    }
  }
  return violations;
}

module.exports = { findTmuxReaperViolation, scanForTmuxReaperViolations };
