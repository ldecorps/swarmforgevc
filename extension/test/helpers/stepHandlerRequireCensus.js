'use strict';

// BL-1630: the require-census helper - runs a step handler's own require
// in a FRESH `node` child process (never in-process: a process that has
// already required some handlers reports a false near-zero for anything
// already cached by an earlier require) and reports both how long it took
// and whether it did any of the three things a handler must never do at
// module load - list a directory, spawn a process, or register a test
// runner (the observable symptom of `require('node:test')` at load: extra
// `process` "exit" listeners, per the 2026-09-17 census that printed "11
// exit listeners added" and "TAP version 13 ... 1..0").
//
// The specifier's original one-off census script (retained for
// re-running in backlog/evidence/BL-1620-specifier-adjudication-of-coder-
// neither-remedy-applies-20260917.md) is this module's ancestor; this
// version is the same `require()`-and-time methodology, packaged so the
// guard test and the evidence script both call the SAME code rather than
// each hand-rolling their own copy.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STEPS_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps');
const INDEX_JS = path.join(STEPS_DIR, 'index.js');

// Mirrors specs/pipeline/steps/index.js's own HANDLER_SUFFIX constant -
// duplicated rather than imported, because importing index.js AT ALL
// eagerly requires every handler (its own documented module-load
// contract: "EAGER, at module load, exactly as the DOMAINS array was"),
// which would pre-populate this process's require cache and defeat a
// census that needs each handler required in isolation.
const HANDLER_SUFFIX = 'Steps.js';

function discoverHandlerFiles(stepsDir = STEPS_DIR) {
  return fs
    .readdirSync(stepsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(HANDLER_SUFFIX))
    .sort();
}

// Runs inside the fresh child: instruments fs.readdirSync and the
// child_process spawn family before each require, and diffs
// process.listenerCount('exit') across it to catch a `node:test`-style
// registration - all three restored immediately after each file so one
// handler's instrumentation never leaks into the next one's reading.
//
// The target list is read from stdin, never embedded in this script's own
// source: with 1200+ handlers the JSON-encoded path list alone is over
// 128KB, and passing it as part of a `-e` argv string hits Linux's
// per-argument MAX_ARG_STRLEN limit (128KB) - independent of, and far
// below, the ARG_MAX the whole argv+envp is allowed (spawnSync then fails
// outright with E2BIG, before this script ever runs). Stdin has no such
// per-argument ceiling and grows with the tree without needing a rewrite.
function buildChildScript() {
  return `
'use strict';
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const NodeModule = require('node:module');
const targets = JSON.parse(fs.readFileSync(0, 'utf8'));
const rows = [];
const orig = {
  readdirSync: fs.readdirSync,
  spawnSync: cp.spawnSync,
  spawn: cp.spawn,
  execFileSync: cp.execFileSync,
  execSync: cp.execSync,
  moduleLoad: NodeModule._load,
};
for (const file of targets) {
  let listedDir = false;
  let spawnedProcess = false;
  let requiredNodeTest = false;
  fs.readdirSync = function (...args) { listedDir = true; return orig.readdirSync.apply(fs, args); };
  cp.spawnSync = function (...args) { spawnedProcess = true; return orig.spawnSync.apply(cp, args); };
  cp.spawn = function (...args) { spawnedProcess = true; return orig.spawn.apply(cp, args); };
  cp.execFileSync = function (...args) { spawnedProcess = true; return orig.execFileSync.apply(cp, args); };
  cp.execSync = function (...args) { spawnedProcess = true; return orig.execSync.apply(cp, args); };
  // Precise, not a proxy: an exit-listener-count diff (an earlier version
  // of this script used one) false-positives on any UNRELATED legitimate
  // process.once('exit', ...) cleanup hook a handler registers for its own
  // reasons. Intercepting node:module's own loader catches exactly and
  // only a require of 'node:test' (or its legacy 'test' alias) anywhere in
  // this handler's own require graph.
  NodeModule._load = function (request, ...rest) {
    if (request === 'node:test' || request === 'test') requiredNodeTest = true;
    return orig.moduleLoad.call(this, request, ...rest);
  };
  const t0 = process.hrtime.bigint();
  let error = null;
  try {
    require(file);
  } catch (e) {
    error = String((e && e.message) || e).slice(0, 200);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  fs.readdirSync = orig.readdirSync;
  cp.spawnSync = orig.spawnSync;
  cp.spawn = orig.spawn;
  cp.execFileSync = orig.execFileSync;
  cp.execSync = orig.execSync;
  NodeModule._load = orig.moduleLoad;
  rows.push({ file: path.basename(file), ms, listedDir, spawnedProcess, registeredTestRunner: requiredNodeTest, error });
}
process.stdout.write('===CENSUS_JSON_START===' + JSON.stringify(rows) + '===CENSUS_JSON_END===');
`;
}

// Out-of-scope handlers (bl1021/bl1064/bl1069) still require node:test at
// load, which registers an exit-time TAP reporter - that fires AFTER this
// script's own synchronous body (including its stdout write) but still
// lands in the same captured stdout, appended after our payload.
// Delimiters make extraction immune to that trailing noise instead of
// needing to fix a defect out of this ticket's scope to get a clean read.
function extractDelimited(output) {
  const match = output.match(/===CENSUS_JSON_START===([\s\S]*?)===CENSUS_JSON_END===/);
  if (!match) {
    throw new Error(`step handler require census: no delimited payload found in output: ${output.slice(0, 500)}`);
  }
  return match[1];
}

function runChildCensus(absolutePaths) {
  const result = spawnSync(process.execPath, ['-e', buildChildScript()], {
    input: JSON.stringify(absolutePaths),
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`step handler require census child failed: ${result.stderr || result.error}`);
  }
  return JSON.parse(extractDelimited(result.stdout));
}

// Census ONE handler, in its own dedicated fresh child process (the
// acceptance feature's own per-handler scenario: no sibling handler's
// require can pre-warm anything this file depends on).
function censusOneHandler(handlerBasename) {
  const absolute = path.join(STEPS_DIR, handlerBasename);
  const [row] = runChildCensus([absolute]);
  return row;
}

// Census EVERY handler in ONE fresh child process, sequentially - the
// aggregate reading the unit-lane guard and the evidence both use. A
// handler requiring a dependency an EARLIER handler (in sorted order)
// already required pays nothing extra for it here, exactly as a real
// registry load behaves (this is the same amortization the specifier's
// original census measured, not an artifact of this helper).
function censusAllHandlers(stepsDir = STEPS_DIR) {
  const files = discoverHandlerFiles(stepsDir);
  const t0 = Date.now();
  const rows = runChildCensus(files.map((f) => path.join(stepsDir, f)));
  return { rows, totalMs: Date.now() - t0 };
}

// The whole-load wall time: `require(index.js)` alone, in a fresh child -
// what bl968's structural probes and the BL-761 registration gate
// actually pay, with NO registerSteps() call (this ticket's target).
function censusIndexJsWallMs() {
  const script = `
'use strict';
const t0 = Date.now();
require(${JSON.stringify(INDEX_JS)});
process.stdout.write('===CENSUS_WALL_START===' + (Date.now() - t0) + '===CENSUS_WALL_END===');
`;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`index.js wall-time child failed: ${result.stderr || result.error}`);
  }
  const match = result.stdout.match(/===CENSUS_WALL_START===(\d+(?:\.\d+)?)===CENSUS_WALL_END===/);
  if (!match) {
    throw new Error(`index.js wall-time child: no delimited payload found in output: ${result.stdout.slice(0, 500)}`);
  }
  return Number(match[1]);
}

// Pure (unless a confirmAlone callback is passed - see below): turns
// census rows into a violations list.
//
// listedDir/spawnedProcess are absolute - the invariant forbids both
// outright, and (measured 2026-09-20) nothing in the real tree does
// either today, so enforcing them tree-wide breaks nothing.
//
// registeredTestRunner is NOT enforced here as an unconditional
// violation, on purpose: a require-census run (2026-09-20, this ticket)
// found 73 pre-existing handlers requiring node:test at module load for
// their own afterEach-based cleanup (a much older, widespread idiom than
// this ticket anticipated - its own description named only three).
// node:test's real one-time init cost is paid once by whichever handler
// is alphabetically first to require it in a sequential census; every
// later one gets it from the require cache near-free, so this behavior
// does not itself blow the ms budget for 72 of the 73. Flagging all 73 as
// hard failures the day this guard lands would be a ~6x scope explosion
// over the twelve this ticket sized ("one sitting" per its own INVEST
// note) - flagged to the specifier as a separate, much larger finding
// (2026-09-20 note, BL-1659) rather than grown into this parcel. The
// field is still recorded on every row (informational, and used by this
// ticket's own twelve-handler acceptance scenario, which asserts it
// false for EXACTLY the handlers this parcel fixed - never a tree-wide
// claim). The ms budget below still catches this behavior's ACTUAL cost
// wherever it becomes large enough to matter.
//
// BL-1633 confirm-a-pole-alone (2026-09-20 ruling): a sequential
// census's own ordering and fork contention can inflate one handler's
// reading over budget without its own require actually costing that
// much (bl1050CursorRunFailureLogSteps.js measured 137-320ms depending
// on host load in-sequence, but a consistent 137-180ms alone). Before
// naming ANY over-budget row a real violation, it is re-measured once
// more in its own fresh, isolated child via the optional `confirmAlone`
// callback (wired to censusOneHandler by real callers; omitted in a pure
// unit test, which then trusts the row's own ms as already-confirmed).
// A handler whose cost is genuine (an eager jsdom require, say) reads
// the same or worse alone; only a sequential-only artifact clears.
//
// allowlist: entries are documented, ticketed debt this ticket exposed
// but does not own (2026-09-20 ruling: "each entry names a reason and an
// owning ticket") - checked only AFTER confirm-alone, so a handler that
// clears on its own is never even looked up (an allowlist entry left in
// place after its handler stopped needing it is caught by the guard's
// own separate "every allowlist entry still exists" test instead).
function checkHandlerBudgets(rows, { budgetMs, allowlist = new Map(), confirmAlone } = {}) {
  const violations = [];
  for (const row of rows) {
    if (row.error) {
      violations.push({ file: row.file, reason: `failed to require: ${row.error}` });
      continue;
    }
    if (row.listedDir) {
      violations.push({ file: row.file, reason: 'lists a directory at module load' });
    }
    if (row.spawnedProcess) {
      violations.push({ file: row.file, reason: 'spawns a process at module load' });
    }
    if (row.ms > budgetMs) {
      const confirmedMs = confirmAlone ? confirmAlone(row.file) : row.ms;
      if (confirmedMs > budgetMs) {
        if (allowlist.has(row.file)) {
          continue;
        }
        violations.push({
          file: row.file,
          reason: `incremental require cost ${confirmedMs.toFixed(1)}ms exceeds the ${budgetMs}ms budget (confirmed alone)`,
        });
      }
    }
  }
  return violations;
}

module.exports = {
  STEPS_DIR,
  INDEX_JS,
  checkHandlerBudgets,
  HANDLER_SUFFIX,
  discoverHandlerFiles,
  censusOneHandler,
  censusAllHandlers,
  censusIndexJsWallMs,
};
