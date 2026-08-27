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

// BL-1032: scope by the HAZARD - can this file cause a real tmux server to
// run - not by the presence of a quoted 'new-session' token.
//
// BL-817 chose the token and explained the quoting: prose and URLs must never
// false-positive, because "every real tmux-server starter in this repo passes
// 'new-session' as its own argv array element". True, and it closed the
// unlikely false-positive class. But it has an unstated converse the guard
// never checked: A FILE THAT ASSERTS ABOUT TMUX ARGV ALSO WRITES
// 'new-session' AS A QUOTED ARGV ELEMENT, because it is comparing against
// argv. That is not an exotic shape - it is what a test for "which tmux
// commands may this repair resolve to?" looks like, and
// bl1018SingleRoleRepairNeverKillsServerSteps.js is exactly it. That file was
// RED BECAUSE IT IS CORRECT: its header says "Nothing here runs tmux, and that
// is the design, not a shortcut", it spawns only `bb -e` to evaluate command
// vectors as data, and the only ways to green it were to add a reaper call
// guarding nothing or to obfuscate the string. A guard whose cheapest
// satisfying move is to write a lie is not measuring the hazard it names.
//
// TWO hazard shapes, and the second is why the obvious fix is wrong. Keying
// purely on a literal spawn naming tmux also exempts
// bl958ControlPlaneLossSteps.js, which reaches tmux through a fake it writes
// at bin/tmux and puts on PATH. Measured across the 11 files carrying the
// token: 9 spawn tmux directly, bl958 stubs it onto PATH, and bl1018 does
// neither. bl958 is compliant today, so exempting it would regress nothing
// VISIBLE - which is exactly what makes that hole worth closing before it is
// dug.

// (1) The file spawns tmux itself AND names a subcommand that CREATES a
// server. Both halves are needed, and the second is not pedantry: `tmux
// list-sessions` and `tmux has-session` are QUERIES - they fail when no server
// is running, they never start one. Scoping on the spawn alone pulled in four
// files that only query (bl458, bl571, bl952, tmuxDoubleAnswers), which would
// have made this fix demand reaper calls for servers those files never start -
// the same lie in the opposite direction from the bug being fixed.
const SPAWNS_TMUX = /(?:execFileSync|execSync|spawnSync|spawn|exec)\s*\(\s*['"]tmux['"]/;
const CREATES_A_SERVER = /['"](?:new-session|start-server)['"]/;

// (2) The file puts a tmux of its own on PATH - it writes a file named tmux
// into a directory it then prepends to PATH. Both halves are required: writing
// a file called tmux is harmless until something can find it.
const WRITES_TMUX_ON_PATH = /(?:writeFileSync|chmodSync)\s*\([^;]*['"]tmux['"]/;
const PREPENDS_TO_PATH = /\bPATH\s*=/;

function startsTmuxServer(text) {
  // BOTH routes require a server-creating subcommand to be named, because
  // that is what separates "can start a server" from "can run tmux".
  if (!CREATES_A_SERVER.test(text)) return false;
  // Route 1: the file spawns tmux itself.
  if (SPAWNS_TMUX.test(text)) return true;
  // Route 2: the file puts a tmux of its own making on PATH, so whatever it
  // runs next can reach one - bl958ControlPlaneLossSteps.js's shape, and the
  // measured reason scoping on a literal spawn alone would be wrong.
  //
  // The creating-subcommand requirement is what keeps this route honest.
  // bl571SequentialRotationDormantParitySteps.js and
  // bl952BouncedParcelNeverApprovedSteps.js write the SAME kind of bin/tmux
  // stub, but neither names a server-creating subcommand anywhere - their
  // stubs are `exit 0` no-ops used to keep a probe quiet. Demanding a reaper
  // from them would be the mirror image of the bug being fixed here: a
  // track() call guarding a server that is never started.
  return WRITES_TMUX_ON_PATH.test(text) && PREPENDS_TO_PATH.test(text);
}
const REQUIRES_FIXTURE_REAPER = /require\(\s*['"]\.\/lib\/fixtureReaper['"]\s*\)/;
const CALLS_TRACK = /\btrack\s*\(/;

// Pure: given one file's own basename + text, returns a violation reason or
// null. Exported separately from the directory walk so a unit/property
// test can drive it directly against fixture strings, no filesystem needed.
function findTmuxReaperViolation(basename, text) {
  if (!startsTmuxServer(text)) {
    return null;
  }
  if (REQUIRES_FIXTURE_REAPER.test(text) && CALLS_TRACK.test(text)) {
    return null;
  }
  return 'can cause a tmux server to run but does not require ./lib/fixtureReaper and call track()';
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

module.exports = { findTmuxReaperViolation, scanForTmuxReaperViolations, startsTmuxServer };
