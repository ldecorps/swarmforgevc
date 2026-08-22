# BL-638 — specifier stamp-path probe, 2026-08-02

BL-638's "Shape" section, item 2, says: *"The specifier should confirm the
stamp-comparison path treats it correctly rather than assume."* This is that
confirmation. It disproved one of the ticket's own claims, so it is recorded
here rather than summarised away.

This is **not** a bounce. Nothing was sent back; the ticket had not yet reached
the coder. It is spec-time evidence attached before handoff.

## What decides what (read this before changing anything)

All of it lives in the **pinned, vendored** APS tool. `engineering.prompt`
forbids modifying or reimplementing it, and BL-638's `out_of_scope` repeats
that. Nothing outside `swarmforge/vendor/aps/` reads or writes a
`# mutation-stamp` — verified by grep across `specs/`, `swarmforge/scripts/`,
`extension/src/`.

| Behaviour | Decided at |
|---|---|
| Zero mutants for an outline-free feature | `bb/src/aps/mutation.clj` — `discover` iterates `(:examples scenario)` only |
| Whether a stamp is written | `bb/src/aps/cli/gherkin_mutator.clj:70` — `write-stamp? = (Survived == 0 && Errors == 0)` |
| Whether the next run is skipped | `bb/src/aps/mutation.clj:350` — `accepted-skips`; empty manifest `scenarios` **and** a valid stamp ⇒ skip every scenario |
| Whether the stamp is still valid | `bb/src/aps/mutation.clj:345` — `feature-stamp-valid?` = `sha256(strip-mutation-metadata(content))` |
| Exit status | `gherkin_mutator.clj:76` — `exit 1` only when `Survived > 0 or Errors > 0` |

Two consequences the coder needs up front:

1. **`write-stamp?` is trivially true at `Total 0`.** With no mutants there are
   no survivors and no errors, so the CLI always stamps. There is no flag to
   suppress it, and our wrapper cannot pass one. A fix must correct the feature
   file *after* the vendored tool returns.
2. **`specs/pipeline/scripts/run_gherkin_mutation.sh` ends in `exec`**, which
   replaces the process. It cannot post-process anything until that `exec` goes.

## The probe

Run from `swarmforge/vendor/aps` with `bb -cp bb/src`. It calls the real
vendored functions (private ones via `#'var`) rather than re-implementing them,
and simulates exactly what the CLI does on a zero-mutant run: a report of
`Total 0 / Survived 0 / Errors 0` with `write-stamp?` = `true`.

```clojure
(require '[aps.mutation :as m] '[aps.gherkin :as g])
(def valid? #'m/feature-stamp-valid?)
(def readmd #'m/read-mutation-metadata)
(def skips  #'m/accepted-skips)
(def discover #'m/discover)

;; 1. an outline-free feature, then the metadata a zero-mutant run writes
(spit f outline-free-feature)
(let [feat (g/parse-file f)]
  (m/write-mutation-metadata!
    f feat {:summary {:Total 0 :Killed 0 :Survived 0 :Errors 0} :results []}
    "unknown" "soft" true))

;; 2. does an UNCHANGED re-run get skipped?
;; 3. then append a Scenario Outline and ask again
```

## Results

```
STEP1 mutants-discovered-outline-free        = 0
STEP2 stamp-written                          = true
STEP2 manifest-scenarios                     = []
STEP2 stamp-valid                            = true
STEP3 skipped-scenarios-unchanged            = #{0} of 1        <- suppression IS real
STEP4 stamp-still-valid-after-adding-outline = false            <- but NOT permanent
STEP4 mutants-discovered-now                 = 4
STEP4 skipped-scenarios                      = #{} of 2
STEP4 WOULD-RUN-MUTANTS                      = 4
```

## Findings

**CONFIRMED — defect 1, exactly as the ticket states it.** An outline-free
feature yields zero mutants (STEP1), writes `scenarios: []` with
`implementation_hash: "unknown"` (STEP2), and exits 0. Indistinguishable from a
clean sweep. This is the load-bearing defect and it covers 216 of 356 feature
files.

**CONFIRMED, NARROWER — defect 2.** A zero-mutant run does write a stamp, and an
**unchanged** re-run is fully suppressed: `accepted-skips` returns every
scenario index (STEP3). So the file is recorded as covered on the strength of
having proved nothing, and stays green on every later run.

**DISPROVEN — the "permanently silent" claim.** BL-638 states *"Adding a
Scenario Outline later does not help while the stamp still matches"* and calls
defect 2 *"the load-bearing half"* because it *"makes the gate permanently
silent for that file."* The stamp is a hash of the feature text with metadata
stripped, so adding an outline necessarily changes the text and invalidates it
(STEP4: stamp invalid, nothing skipped, 4 mutants generated). **The gate re-arms
by itself.** Suppression lasts only as long as the file is untouched.

## Effect on the acceptance contract

The approved scenario 02 asserted the disproven behaviour — that adding an
outline would still be suppressed. **It passed before a line of code was
written.** A vacuous criterion is precisely the failure this ticket exists to
eliminate, so shipping it would have been self-defeating: the coder would either
"satisfy" it with no work or bounce the ticket back.

Replaced with two scenarios, neither vacuous:

- **02 (new)** — an already-stamped, **unchanged** outline-free feature must
  still report inapplicable on re-run. This is STEP3, and it fails today.
- **07 (new)** — adding an outline still re-arms the gate. Currently true, kept
  as a **regression guard**: whatever the fix does about the stamp must not
  break behaviour that already works correctly.

Nothing was lost in the swap, and the ticket's invariant — *"a mutation run that
generated zero mutants never reports a pass and never stamps the feature as
covered — for any feature shape"* — is unchanged and now actually tested.

## Consequence for severity

`severity: high` was priced partly on the disproven permanence claim. Left at
`high` rather than lowered unilaterally: defect 1 alone — a quality gate
reporting success while testing nothing, across 60% of the corpus — justifies
it. Surfaced to the human for re-pricing via `human_approval: pending`.
