'use strict';

// BL-1398: the commit-guard property fixture's guard set, DERIVED from what
// the hooks actually run rather than listed by hand.
//
// The fixture in bl632CommitTimeGuardInvariants.property.test.js copies the
// real guards into a throwaway repository. When that list was hand-written it
// went stale the moment a guard joined the runner: BL-1385's
// check_handler_module_graph.sh landed on 2026-09-04, the fixture's runner
// could not find it, every generated case failed with "No such file or
// directory", and the property test was red on main - saying nothing about any
// guard being wrong, only that a list in a test had not been updated. It is
// the BL-973 / BL-1279 membership shape: a closure enumerated by hand goes
// stale the moment the thing it mirrors grows.
//
// So the set is a function of the runner and the hooks, read at test time.

const fs = require('node:fs');
const path = require('node:path');

const RUNNER_REL = 'swarmforge/scripts/run_commit_guards.sh';
const HOOK_RELS = ['swarmforge/git-hooks/pre-commit', 'swarmforge/git-hooks/pre-merge-commit'];
const SCRIPTS_REL = 'swarmforge/scripts';

// `run_guard <script> [args...]` is the one line shape the chain uses to run a
// guard (commit_guard_chain_lib.sh), in the runner and in pre-merge-commit's
// own chain. Comments are skipped: a line that merely MENTIONS run_guard is
// prose, not a guard the chain runs.
const RUN_GUARD_LINE = /^[ \t]*run_guard[ \t]+(\S+)([^\n]*)$/;

// `source X` / `. X`, taking the last *.sh path segment on the line - the
// forms in use are "$SCRIPT_DIR/x.sh", "$SCRIPTS_DIR/x.sh" and
// "$(cd "$(dirname ...)" && pwd)/x.sh", and all three end in the basename.
const SOURCE_LINE = /^[ \t]*(?:source|\.)[ \t]+(\S.*)$/;
const SH_BASENAME = /([A-Za-z0-9_.-]+\.sh)/g;

function linesOf(text) {
  return text.split('\n').filter((line) => !/^[ \t]*#/.test(line));
}

// The guards a file's chain runs, in order, with the arguments it passes them
// (check_commit_size.sh takes a size limit; warming the executable wants the
// same shape the chain uses).
function parseRunGuardEntries(text) {
  const out = [];
  for (const line of linesOf(text)) {
    const m = RUN_GUARD_LINE.exec(line);
    if (!m) continue;
    out.push({ script: m[1], args: m[2].trim() ? m[2].trim().split(/\s+/) : [] });
  }
  return out;
}

// The *.sh files a script sources. One hop per call; the caller walks the
// graph, and the walk never leaves swarmforge/scripts.
function parseSourcedScripts(text) {
  const out = [];
  for (const line of linesOf(text)) {
    const m = SOURCE_LINE.exec(line);
    if (!m) continue;
    const names = m[1].match(SH_BASENAME);
    if (names && names.length) out.push(names[names.length - 1]);
  }
  return out;
}

// Every file the fixture must carry for its hooks to run production's chain,
// and nothing else. Throws - naming the guard - when the runner names a guard
// the tree does not have (invariant 2): a fixture that quietly skipped it
// would run a narrower chain than production and still report green.
//
// `runnerRel` is a seam so a test can point the derivation at its own runner
// copy; the live runner is the default and is never written by these tests.
function deriveCommitGuardFixtureSet({
  repoRoot,
  runnerRel = RUNNER_REL,
  hookRels = HOOK_RELS,
  readFile = (p) => fs.readFileSync(p, 'utf8'),
  exists = (p) => fs.existsSync(p),
} = {}) {
  const abs = (rel) => path.join(repoRoot, rel);
  const files = [];
  const warmArgs = new Map();
  const add = (rel) => {
    if (!files.includes(rel)) files.push(rel);
  };

  // The chain's entry points. The two hooks stay explicit: they are what git
  // runs, not what the runner lists.
  const chainSources = [runnerRel, ...hookRels];

  const guards = [];
  for (const rel of chainSources) {
    if (!exists(abs(rel))) {
      throw new Error(`commit-guard fixture: the chain source ${rel} is absent from the tree at ${abs(rel)}`);
    }
    for (const entry of parseRunGuardEntries(readFile(abs(rel)))) {
      if (!guards.some((g) => g.script === entry.script)) guards.push(entry);
    }
  }

  for (const { script, args } of guards) {
    const rel = `${SCRIPTS_REL}/${script}`;
    if (!exists(abs(rel))) {
      throw new Error(
        `commit-guard fixture: ${runnerRel} names the guard ${script}, which is absent from the tree at ${abs(rel)}. ` +
          'The fixture never skips a guard the chain runs - that would test a narrower chain than production.',
      );
    }
    add(rel);
    warmArgs.set(rel, args);
  }

  // The libs those files source, walked inside swarmforge/scripts only. A lib
  // referenced behind an `[[ -f ]]` test may legitimately be absent, so a
  // missing lib is reported rather than thrown - unlike a guard, it never
  // narrows the chain silently, because the guard that wanted it still runs
  // and says so itself.
  const missingLibs = [];
  const pending = [...chainSources, ...files];
  const seen = new Set();
  while (pending.length) {
    const rel = pending.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const name of parseSourcedScripts(readFile(abs(rel)))) {
      const libRel = `${SCRIPTS_REL}/${name}`;
      if (!exists(abs(libRel))) {
        if (!missingLibs.includes(libRel)) missingLibs.push(libRel);
        continue;
      }
      if (!seen.has(libRel)) pending.push(libRel);
      add(libRel);
    }
  }

  add(runnerRel);
  for (const rel of hookRels) add(rel);

  return { files, guards: guards.map((g) => g.script), warmArgs, missingLibs };
}

module.exports = {
  RUNNER_REL,
  HOOK_RELS,
  deriveCommitGuardFixtureSet,
  parseRunGuardEntries,
  parseSourcedScripts,
};
