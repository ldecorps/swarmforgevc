'use strict';

// BL-1449: OPERATOR_RUNTIME_BB_FILES used to be a hand-typed array that
// five step handlers copy into a disposable root before running
// operator_runtime.bb. BL-944 (2026-08-19) added a check comparing that
// array against the real transitive load-file closure computed from
// source (operatorRuntimeBbClosure.js) - the check caught every drift
// LOUDLY, but the list still drifted nine times
// (BL-412/413/458/647/655/944/1265/1439, plus the tenth folded into this
// ticket) because a maintained-by-hand list is only ever a snapshot of
// the real closure at the moment someone last retyped it. The fix is to
// stop maintaining a snapshot: the export below IS the closure, computed
// at module load, so a new load-file anywhere in operator_runtime.bb's
// transitive chain is in the fixture the moment it exists, with no edit
// to this file.
//
// operator_ask.bb is not part of the closure (BL-944 verified it is not
// reachable from operator_runtime.bb by any load-file chain, and no
// consumer of this list spawns it from the fixture root either), so it is
// correctly absent from the derived list.
const path = require('node:path');
const { computeClosure } = require('./operatorRuntimeBbClosure');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', '..', 'swarmforge', 'scripts');
const ENTRY_FILE = 'operator_runtime.bb';

// A file named here but NOT reached by any load-file chain from
// operator_runtime.bb rides the fixture anyway, for a non-load-file
// reason that must be stated - BL-944 scenario 03's undeclared-extra
// check still runs against whatever is here. {file, reason} per entry.
// Empty today: no such file exists.
const OPERATOR_RUNTIME_BB_DECLARED_EXTRAS = [];

// Pure given a stable scriptsDir: the transitive load-file closure of
// operator_runtime.bb within it, sorted for a stable order. Takes the
// scripts dir as a parameter (rather than assuming SCRIPTS_DIR) so a
// scratch copy of the tree can be probed without touching the live one
// (BL-1390).
function deriveOperatorRuntimeClosure(scriptsDir) {
  return [...computeClosure(scriptsDir, ENTRY_FILE)].sort();
}

// Pure: appends declaredExtras onto a derived closure to produce the flat
// filename list every consumer copies into a fixture root. Extracted so the
// append itself is unit-testable independent of the live, currently-empty
// OPERATOR_RUNTIME_BB_DECLARED_EXTRAS (hardener, BL-1449: a hand-mutation
// check found the concat step had zero coverage while extras stays empty -
// nothing distinguishes "appended" from "dropped").
function buildOperatorRuntimeBbFiles(closure, declaredExtras) {
  return closure.concat(declaredExtras);
}

const OPERATOR_RUNTIME_BB_FILES = buildOperatorRuntimeBbFiles(deriveOperatorRuntimeClosure(SCRIPTS_DIR), OPERATOR_RUNTIME_BB_DECLARED_EXTRAS);

module.exports = {
  OPERATOR_RUNTIME_BB_FILES,
  OPERATOR_RUNTIME_BB_DECLARED_EXTRAS,
  deriveOperatorRuntimeClosure,
  buildOperatorRuntimeBbFiles,
  SCRIPTS_DIR,
};
