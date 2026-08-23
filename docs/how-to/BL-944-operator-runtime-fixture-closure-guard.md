# Keeping the operator_runtime.bb JS fixture list honest (BL-944)

Four acceptance step handlers (driving `BL-647-rotation-router-liveness`,
`BL-368-control-loss-is-not-agent-death`, `BL-359-always-on-operator-presence`,
and this ticket's own feature) build a disposable fixture root by copying a
named list of Babashka files, then shell out to a real
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

- `OPERATOR_RUNTIME_BB_FILES` — every file the four JS step handlers copy.
- `OPERATOR_RUNTIME_BB_DECLARED_EXTRAS` — `{file, reason}` entries for a file
  that legitimately belongs in the fixture for a reason other than being in
  `operator_runtime.bb`'s own load-file closure. Empty by design; an
  undeclared extra is a guard failure, not a silent pass.

## The guard

Before BL-944 the list was hand-maintained, and drifted from the real
transitive `load-file` closure of `operator_runtime.bb` six times
(BL-412/413/458/647/655/944) — each time as every consumer scenario failing
at once with a `FileNotFoundException` naming a file no scenario mentions,
because the header comment recording the last drift was never itself a gate
(the standing rule this closes: engineering.prompt's "a constant mirrored by
hand across a language boundary no import can bridge needs a test asserting
both literals agree", BL-897).

`specs/pipeline/steps/lib/operatorRuntimeBbClosure.js` now derives the real
closure from source instead of trusting the list: it walks every
`(load-file ... "NAME.bb")` form in `operator_runtime.bb`, follows each
target transitively, and diffs the result against
`OPERATOR_RUNTIME_BB_FILES`. `extension/test/operatorRuntimeBbFixtureClosure.test.js`
runs that diff as a standing test — the one suite every parcel runs
(`npm test` from `extension/`) — and fails naming exactly the file that
drifted, never the whole batch of downstream scenarios.

## Adding a new load-file dependency

When a change adds a `load-file` anywhere in `operator_runtime.bb`'s own
transitive closure (directly, or inside a file it already loads):

1. Add the new `.bb` filename to `OPERATOR_RUNTIME_BB_FILES`.
2. Run `npx vitest run extension/test/operatorRuntimeBbFixtureClosure.test.js`
   from the repo root. A missing entry fails the last test in the file,
   naming the file in `missing`; a listed file the closure no longer reaches
   fails the same test naming it in `extra`.
3. If a file genuinely needs to ride the fixture without being in the
   closure (BL-944 found none), add it to `OPERATOR_RUNTIME_BB_DECLARED_EXTRAS`
   with a `reason` instead of leaving it undeclared.

No other file needs touching — the four step handlers all import
`OPERATOR_RUNTIME_BB_FILES` from the one module.

## Acceptance

`specs/features/BL-944-operator-runtime-fixture-dependency-closure.feature`
