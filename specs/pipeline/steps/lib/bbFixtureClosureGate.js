'use strict';

// BL-973: the guard that keeps every enrolled fixture copy-list honest
// (five at BL-973, nine after BL-1279 enrolled the front-desk four).
//
// Each list names the .bb dependencies a fixture must copy for a real bb
// subprocess to load. Hand-maintained, they drift the moment anything upstream
// gains a load-file edge - which happened three times (BL-911's
// prompt_engine_lib.bb, BL-967's daemon_cycle_guard_lib.bb, BL-1029's
// shell_quote_lib.bb), each time reddening two acceptance features and a shell
// test with a stack trace naming a file no scenario mentions.
//
// THE ENTRY POINT IS PER-FIXTURE and is not always handoff_lib.bb. Each
// fixture drives its own CLI: pipeline_stage_cli.bb and
// done_with_current_task.bb each pull pipeline_stage_lib.bb on top of
// handoff_lib.bb's set, and operator_runtime.bb pulls twenty-four more. A
// guard pinned to one script would green a fixture missing its own CLI's
// direct dependency, which is why the table below pairs them.
//
// The effective list is read BEHAVIOURALLY - what the fixture actually copies
// or actually exports - never by parsing its source for a literal. A source
// grep would pass against a comment, and a "kept in sync" comment is exactly
// what failed here three times (BL-897).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { computeClosure } = require('./operatorRuntimeBbClosure.js');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

// file (repo-relative) -> { entry, kind }. `kind` says how the effective list
// is obtained, because the five are not the same sort of thing.
const FIXTURES = {
  'specs/pipeline/steps/bl814LiveRoleHeldLoudDegradeSteps.js': {
    entry: 'pipeline_stage_cli.bb',
    kind: 'module',
  },
  'specs/pipeline/steps/bl487BoardFreshnessWithoutCoordinatorSyncSteps.js': {
    entry: 'pipeline_stage_cli.bb',
    kind: 'module',
  },
  'extension/test/readLiveRoleHeldTicketsCli.test.js': {
    entry: 'pipeline_stage_cli.bb',
    // A vitest file: requiring it needs the test globals stubbed. Nothing but
    // constants executes at its module load.
    kind: 'vitest-module',
  },
  'swarmforge/scripts/test/test_lean_ledger_bb_wiring.sh': {
    entry: 'done_with_current_task.bb',
    kind: 'shell-copy',
  },
  // BL-1279: the four front-desk supervisor fixtures. They existed unguarded
  // for months beside this table because BL-973 derived each list's CONTENTS
  // but left WHICH fixtures are guarded hand-enumerated here - by the time
  // they were found, all four were red and five of one file's eight checks
  // were passing vacuously against a subprocess that never started.
  'swarmforge/scripts/test/test_front_desk_supervisor_bl622_refusal.sh': {
    entry: 'front_desk_supervisor.bb',
    kind: 'shell-copy',
  },
  'swarmforge/scripts/test/test_front_desk_supervisor_tick.sh': {
    entry: 'front_desk_supervisor.bb',
    kind: 'shell-copy',
  },
  'swarmforge/scripts/test/test_front_desk_supervisor_liveness.sh': {
    entry: 'front_desk_supervisor.bb',
    kind: 'shell-copy',
  },
  'swarmforge/scripts/test/test_front_desk_supervisor_fleet_creds.sh': {
    entry: 'front_desk_supervisor.bb',
    kind: 'shell-copy',
  },
  'swarmforge/scripts/test/lib/operator_runtime_sandbox.sh': {
    entry: 'operator_runtime.bb',
    // Sourced and RUN into a scratch dir; the files that land are the answer.
    kind: 'shell-sandbox',
  },
};

function requireFresh(absPath, stubVitestGlobals) {
  delete require.cache[require.resolve(absPath)];
  if (!stubVitestGlobals) return require(absPath);
  const saved = {};
  const names = ['test', 'it', 'describe', 'expect', 'beforeEach', 'afterEach'];
  for (const n of names) {
    saved[n] = global[n];
    if (typeof global[n] === 'undefined') global[n] = () => {};
  }
  try {
    return require(absPath);
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete global[n];
      else global[n] = saved[n];
    }
  }
}

// Runs the shared shell helper the two shell fixtures use, into a scratch dir,
// and returns the .bb files that actually landed.
function shellCopyList(scriptsDir, sourceLine, invocation) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bl973-gate-'));
  try {
    execFileSync(
      'bash',
      ['-c', `set -euo pipefail\n${sourceLine}\n${invocation}`],
      { encoding: 'utf8', env: { ...process.env, SRC: scriptsDir, DEST: dest } }
    );
    return fs.readdirSync(dest).filter((f) => f.endsWith('.bb')).sort();
  } finally {
    // BL-971: in a finally, so a throw above cannot leak the scratch dir.
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

// The set a fixture ACTUALLY copies, obtained without reading its source.
function effectiveList(scriptsDir, fixtureFile) {
  const spec = FIXTURES[fixtureFile];
  if (!spec) throw new Error(`bbFixtureClosureGate: unknown fixture ${fixtureFile}`);
  const abs = path.join(REPO_ROOT, fixtureFile);

  if (spec.kind === 'module' || spec.kind === 'vitest-module') {
    const mod = requireFresh(abs, spec.kind === 'vitest-module');
    const declared = mod.BB_FIXTURE_CLOSURE;
    if (!declared || !Array.isArray(declared.files)) {
      throw new Error(
        `bbFixtureClosureGate: ${fixtureFile} exports no BB_FIXTURE_CLOSURE - ` +
          'the gate cannot see what it copies, so the list is unguarded'
      );
    }
    return { entry: declared.entry, files: [...declared.files].sort() };
  }

  if (spec.kind === 'shell-sandbox') {
    return {
      entry: spec.entry,
      files: shellCopyList(
        scriptsDir,
        `source "${path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'lib', 'operator_runtime_sandbox.sh')}"`,
        'copy_operator_runtime_sandbox "$SRC" "$DEST"'
      ),
    };
  }

  // shell-copy: the fixture calls copy_bb_closure with this entry point, so
  // running the shared helper the same way is what it does.
  return {
    entry: spec.entry,
    files: shellCopyList(
      scriptsDir,
      `source "${path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'lib', 'bb_closure_copy.sh')}"`,
      `copy_bb_closure "$SRC" "$DEST" ${spec.entry}`
    ),
  };
}

// The check itself: every member of the entry point's closure that the fixture
// would not copy. Empty means the fixture is complete for that entry point.
// closureDir defaults to scriptsDir but is separable, which is what lets a
// scratch tree with one extra load-file edge prove the guard actually fires.
function missingFromList(scriptsDir, fixtureFile, closureDir) {
  const { entry, files } = effectiveList(scriptsDir, fixtureFile);
  const closure = computeClosure(closureDir || scriptsDir, entry);
  const have = new Set(files);
  return { entry, files, missing: [...closure].filter((f) => !have.has(f)).sort() };
}

module.exports = { FIXTURES, effectiveList, missingFromList, REPO_ROOT };
