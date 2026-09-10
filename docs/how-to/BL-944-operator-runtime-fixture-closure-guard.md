# Keeping the operator_runtime.bb JS fixture list honest (BL-944)

Five acceptance step handlers (driving `BL-647-rotation-router-liveness`,
`BL-368-control-loss-is-not-agent-death`, `BL-359-always-on-operator-presence`,
BL-944's own feature, and BL-1449's own feature) build a disposable fixture
root by copying a list of Babashka files, then shell out to a real
`bb operator_runtime.bb <root> --tick-once`. Babashka resolves every
`load-file` relative to the loading file, so a file missing from that list is
missing from the fixture, and the subprocess dies at load time — before the
scenario reaches the behavior it means to exercise.

This is a **different** mechanism from
[BL-671's shell-fixture sandbox](BL-671-operator-runtime-fixture-sandbox.md)
(`operator_runtime_sandbox.sh` / `OPERATOR_RUNTIME_SANDBOX_LIBS`, used by the
`test_operator_runtime_*.sh` shell suite). Both copy a hand-picked subset of
the same `.bb` files into a fixture root for the same underlying reason, but
they are two independent lists — updating one does not update the other.

[BL-973](BL-973-bb-fixture-closure-guards-and-suite-inventory.md) extends
this same closure-derived discipline to four more fixture copy-lists
(including `operator_runtime_sandbox.sh`'s own list, previously unguarded)
and adds a standing inventory gate over `swarmforge/scripts/test/` itself.

## The list

`specs/pipeline/steps/lib/operatorRuntimeBbFixtureFiles.js` exports:

- `OPERATOR_RUNTIME_BB_FILES` — every file the five JS step handlers copy.
  Since BL-1449 (2026-09-10) this is **computed at module load**, not typed:
  `deriveOperatorRuntimeClosure(SCRIPTS_DIR)` (the transitive `load-file`
  closure of `operator_runtime.bb`, sorted) concatenated with
  `OPERATOR_RUNTIME_BB_DECLARED_EXTRAS`. No file name is written into this
  module.
- `OPERATOR_RUNTIME_BB_DECLARED_EXTRAS` — `{file, reason}` entries for a file
  that legitimately belongs in the fixture for a reason other than being in
  `operator_runtime.bb`'s own load-file closure. Empty by design; an
  undeclared extra is a guard failure, not a silent pass.

## The guard

Before BL-944 the list was hand-maintained, and drifted from the real
transitive `load-file` closure of `operator_runtime.bb` repeatedly
(BL-412/413/458/647/655/944, then BL-1265/1439 and a ninth drift on
2026-09-09) — each time as every consumer scenario failing at once with a
`FileNotFoundException` naming a file no scenario mentions, because the
header comment recording the last drift was never itself a gate (the
standing rule this closes: engineering.prompt's "a constant mirrored by hand
across a language boundary no import can bridge needs a test asserting both
literals agree", BL-897).

`specs/pipeline/steps/lib/operatorRuntimeBbClosure.js` derives the real
closure from source: it walks every `(load-file ... "NAME.bb")` form in
`operator_runtime.bb` and follows each target transitively. Before BL-1449
this closure was only diffed against a hand-typed list; nine drifts later,
BL-1449 made the exported list itself the closure's output, so there is
nothing left to drift. `extension/test/operatorRuntimeBbFixtureClosure.test.js`
still runs the diff as a standing test — the one suite every parcel runs
(`npm test` from `extension/`) — but its "list matches the closure"
assertion is now true by construction; it guards the walk's determinism and
the extras list rather than catching a retype.

## Adding a new load-file dependency

Nothing to do here anymore. A `load-file` added anywhere in
`operator_runtime.bb`'s own transitive closure (directly, or inside a file it
already loads) is in `OPERATOR_RUNTIME_BB_FILES` the next time the module
loads — no edit to `operatorRuntimeBbFixtureFiles.js`, no vitest re-run
required to pick it up.

If a file genuinely needs to ride the fixture **without** being in the
closure, add it to `OPERATOR_RUNTIME_BB_DECLARED_EXTRAS` with a `reason`
(empty today — BL-944 found none) instead of leaving it undeclared;
`extension/test/operatorRuntimeBbFixtureClosure.test.js` still fails naming
an undeclared extra.

No other file needs touching — the five step handlers all import
`OPERATOR_RUNTIME_BB_FILES` from the one module.

## Acceptance

`specs/features/BL-944-operator-runtime-fixture-dependency-closure.feature`,
`specs/features/BL-1449-the-operator-runtime-fixture-list-is-derived-never-typed.feature`
