# Running the APS candidate-toolchain equivalence harness

*How-to. Task-oriented: run the harness, read its verdict matrix, and know
what it deliberately refuses to do.*

The APS Babashka tools this repo's Gherkin gates consume are **pinned** —
`swarmforge.lock.json` names the SHA, `install_aps_tools.sh` vendors that SHA
into `swarmforge/vendor/aps/`, and bumping the pin is a **human commit, never
an agent action** (engineering.prompt). This harness exists so that decision is
made against measured evidence rather than a changelog reading: it runs the
pinned toolchain and a candidate toolchain over the same corpus and reports,
cell by cell, where they agree.

It is **not** wired into any gate. Live gates keep consuming the pinned
vendored copy; the harness is something a human runs on demand.

## Run it

```bash
swarmforge/scripts/aps_equivalence_run.sh [repo-root] [work-dir] [corpus-limit]
```

- `repo-root` — defaults to the repo the script lives in.
- `work-dir` — defaults to a fresh temp dir, whose path is printed. It holds
  the two result sets, `matrix.txt`, and `matrix.md`, and is **left in place**
  for inspection.
- `corpus-limit` — a smoke-run seam. Omit it for the real evidence run.

The script clones the candidate, checks out the ticket's SHA, and **refuses to
proceed** (exit `2`) if `rev-parse HEAD` is anything else — the same
clone-at-SHA-and-verify discipline as `install_aps_tools.sh`. To re-run offline
against a checkout you already have, point it at one:

```bash
APS_EQUIVALENCE_CANDIDATE_DIR=/path/to/candidate \
  swarmforge/scripts/aps_equivalence_run.sh
```

The SHA verification still applies to that directory — the env var skips the
clone, not the check.

## Read the matrix

Each corpus entry is compared across three gate lanes, so the matrix has one
row per *entry × gate* cell:

| Lane | What runs |
|------|-----------|
| `lint-parse` | Each toolchain's own `parse-file` + `write-json!` (the `gherkin-parser` CLI's exact body, at that CLI's own defaults), then the real `gherkin_lint_gate_cli.bb` spawned over the produced IR — the same two-step sequence `gherkin_lint_gate.sh` runs. |
| `ir-dry` | Each toolchain's `read-json-file` + `analyze` (the `gherkin-ir-dry-checker` CLI's body). The compared outcome is the **finding set**, not file bytes. |
| `mutation-sites` | `parse-file` + `discover` over the existing gherkin-mutation fixture — **enumeration only**, no mutation loop. |

Corpus: every live `specs/features/*.feature`. `.feature.draft` companions are
excluded by design — they are parked future-slice Gherkin, not live contracts.

Each cell reads `VERDICT|entry|gate[|detail]`, with verdicts:

- **EQUIVALENT** — both sides recorded the same outcome.
- **DIVERGENT** — both sides recorded an outcome and they differ; `detail`
  names how.
- **INCOMPLETE** — an outcome is **missing** from one side.

The harness **fails closed**: it exits `0` only for a *non-empty*
all-EQUIVALENT matrix. An empty result set is `INCOMPLETE`, not equivalence —
"nothing compared" never reads as "nothing diverged".

The toolchains run their *own* namespaces, on their own classpath, called
exactly as their CLIs call them. Nothing is reimplemented (engineering.prompt
forbids reimplementing an APS command); a divergence in the matrix is a
divergence between two real toolchains.

## Re-compare without re-running

The comparator is a separate CLI over an existing work dir:

```bash
bb swarmforge/scripts/aps_equivalence_cli.bb compare <work-dir>
```

Safe to re-run alone after a result file is added or removed — which is how you
verify fail-closed behavior live: delete one candidate-side result file and
re-run, and the affected cell must flip to `INCOMPLETE` with a non-zero exit.

## Evaluate a `--do-not-infer` shim

The candidate parser infers default parameters by default, so a plain run
measures what a *bare* pin bump would do. To measure what the bump would do
*with* a `--do-not-infer` shim at the parser call sites, re-run **only the
candidate side** with the seam set, against the pinned results already in the
work dir, then re-compare:

```bash
APS_EQUIVALENCE_NO_INFER=1 \
  bb swarmforge/scripts/aps_equivalence_runner.bb \
     candidate <candidate-dir> <repo-root> <work-dir>
bb swarmforge/scripts/aps_equivalence_cli.bb compare <work-dir>
```

Set the variable to any value — the runner tests only whether it is present.
It is a **candidate-side** seam: the pinned parser has no options arity, so do
not set it for a `pinned` run (or for `aps_equivalence_run.sh`, which runs both
sides).

## What it never touches

Every pinned surface is **read-only** to a run, by construction — every write
path is derived from the work dir:

- `swarmforge/vendor/aps/` is read as the pinned toolchain, never written.
- `swarmforge.lock.json` is read for the repo URL, never edited.
- `upstream-watch.json` is not touched at all.
- The candidate is never copied into `vendor/`.

After a full run, `git status` must show all three untouched, and the live
`gherkin_lint_gate.sh` must still run against the pinned vendored copy.

The pin bump itself, the re-vendor, and any `upstream-watch.json` edit remain
separate **human** commits made after reading the evidence.

## The evidence it produced

The 2026-08-20 run against candidate `1001283af` is written up in
[`backlog/evidence/BL-959-aps-equivalence-report.md`](../../backlog/evidence/BL-959-aps-equivalence-report.md),
with the four sections a pin-bump decision needs: per-commit classification for
all seven candidate commits, the verdict matrix, the entry-point compatibility
check for every local caller of `swarmforge/vendor/aps`, and a recommendation.

Its recommendation is **bump-with-shims** — the candidate is a clean
fast-forward with compatible CLI contracts, but two commits change behavior the
pipeline depends on and both need a shim in the same commit as any bump: parser
default-inference (a bare bump flips 32 of 604 live features from lint-pass to
lint-fail and reshapes 293 IR-DRY finding sets; with `--do-not-infer` at the two
parser call sites the corpus is 1209/1209 EQUIVALENT), and gherkin-mutation
metadata relocation (without a shim, soft mutation runs silently degrade to full
ones). The report also records the three ways its own evidence could be wrong.

The standing upstream-adoption decision log is
[`docs/upstream-deviations.md`](../upstream-deviations.md).

## Verifying the harness itself

Babashka has no mutation, CRAP, or DRY tooling wired in this repo, so this
harness is gated by its own unit tests only —
`swarmforge/scripts/test/aps_equivalence_{lib,cli}_test_runner.bb` and
`aps_equivalence_lib_property_runner.bb`. Read any hardening claim about it as
that degraded fallback, not as a mutation-scored pass.
