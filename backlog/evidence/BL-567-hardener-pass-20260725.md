# BL-567 hardener pass — 2026-07-25

Hand-run stage 5. Preconditions checked first per the role's own rule: no orphaned
`node --test` or `stryker` processes, no leftover fixture sleeps.

## Both standard mutation gates are inapplicable, and one of them lies

**Stryker** mutates `extension/out/` — JavaScript. `expedite_lib.bb` and
`expedite_cli.bb` are babashka. Nothing to run.

**The BL-113 Gherkin acceptance mutator ran and reported a pass that proves
nothing:**

```
Total 0 | Killed 0 | Survived 0 | Errors 0
manifest: {"scenarios":[], "implementation_hash":"unknown"}
```

`discover` in `swarmforge/vendor/aps/bb/src/aps/mutation.clj` iterates
`(:examples scenario)` — it mutates **Examples-table cells only**. This feature has
no Scenario Outlines, deliberately: outlines are what produce the unreferenced-column
lint finding and the shared-cell mutation survivor that has recurred five times in
this repo. So there was nothing to mutate.

Zero mutants reads exactly like a clean sweep. This is the same shape as the
recorded repo-wide Stryker 0-kill, and worse here, because the mutator **writes a
`# mutation-stamp` into the feature file** — so a later run would skip as
"already done" on the strength of a run that generated nothing. Manifest left
unedited (it is the tool's artifact) with a loud comment above it saying what it
does and does not mean.

## So the gate was built rather than declared satisfied

`swarmforge/scripts/test/expedite_mutation_sweep.sh` — **41 mutants** across
`expedite_lib.bb`, each a single surgical edit a correct suite must reject. Killed
by the unit runner or the property runner.

Deliberately includes mutants nobody wrote a test for. A sweep that only re-checks
assertions you already wrote is the non-vacuity proof, not hardening.

Final: **killed=41 survived=0 skipped=0**.

## Two survivors on the first run — both real gaps

### Survivor 1: `repeated-class` picked the rarest instead of the most frequent

`(sort-by (comp - val))` → `(sort-by val)` survived. Nothing pinned WHICH class is
named when two classes both repeat:

```
bounces [a a b b b]   correct -> "b"   mutant -> "a"
```

This matters rather than being pedantry. `exhaustion-report` names "the repeated
defect class" and routes the ticket to the specifier on it. Naming the *less*
frequent concern points the specifier at the wrong invariant — precisely the
failure BL-633 exists to prevent. Closed with two assertions, one of which also
pins that order of appearance must not override frequency.

### Survivor 2: one of my own tests was VACUOUS

`(when (and v (not (str/starts-with? (str v) "--"))) v)` → `v` survived, even
though the cleaner pass had added a test for exactly that guard.

Why it survived:

```
flag-value with the guard, argv [… --bounce-bound --dry-run]  ->  nil
parse-long "--dry-run"                                        ->  nil
```

The test asserted `:bounce-bound` was `nil` — but the `nil` came from
`parse-long`, not from the guard. Deleting the guard changed nothing observable,
so the test **could not fail**. It was measuring the wrong thing while looking
like coverage.

Closed by asserting on `flag-value` directly, plus a positive case so the function
is pinned in both directions, keeping the end-to-end assertion as a third check
rather than the only one.

That is the single most useful thing this stage produced: a test that had been
green since the cleaner pass and was proving nothing.

## CRAP / DRY

No CRAP tooling exists for babashka in this repo — the CRAP gate is
`extension/`-scoped. Stated rather than silently skipped. The DRY position is the
cleaner pass's: arg parsing centralised in the lib with `value-flags` as the single
source of truth, and the duplicated once-firing stage runner extracted in the step
handlers. `jscpd` covers `extension/` and has nothing to say about `.bb`.

## Suites after this stage

```
mutation sweep   41 mutants               killed=41 survived=0 skipped=0
non-vacuity      8 properties broken      7 independent + 1 recorded as subsumed
properties       8 x 500 runs             ALL PROPERTIES HOLD
lib unit         101 assertions           ALL PASS
CLI              53 assertions            ALL PASS
acceptance       21 scenarios             21/21
```

## Handed forward to the documenter

The Gherkin-mutation inapplicability is worth a line in the runbook, not just this
file: any ticket whose feature has no Scenario Outlines gets `Total 0` from that
gate and a stamp that suppresses future runs. That is a repo-wide trap, not a
BL-567 one, and it deserves its own ticket.
