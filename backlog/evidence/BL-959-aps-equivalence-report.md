# BL-959 — APS candidate-toolchain equivalence evidence

Pinned `accaa33d503340c56513ef387258f8da929ba902` (swarmforge.lock.json) vs
candidate `codex/bb-tools-equivalence` head
`1001283af353d3c5072fc5f07f2b9f5dbf7336e8` (verified by `git rev-parse HEAD`
after clone; the branch sits DIRECTLY on the pin — `git merge-base` with the
candidate is exactly the pin, so a bump is a fast-forward of the vendored bb
tools). Run 2026-08-20 by the harness this ticket adds
(`swarmforge/scripts/aps_equivalence_run.sh`, comparator
`aps_equivalence_cli.bb` / `aps_equivalence_lib.bb`, per-side driver
`aps_equivalence_runner.bb`). The pin bump itself remains a separate human
commit — nothing here touches `swarmforge/vendor/aps/`,
`swarmforge.lock.json`, or `upstream-watch.json` (declared invariant 1;
verified by `git status` over those paths before/after the run).

## 1. Per-commit classification (all seven, oldest first)

The intake classified five commits as porting/docs; measured against the
diffs, three of those five touch `bb/src` — two classifications needed
correcting (marked ✗).

| commit | subject | intake said | measured |
|---|---|---|---|
| `1dd6bc09a` | Add babashka acceptance tools | porting | ✗ **refactor with behavior edges**: rewrites all three bb CLIs' option parsing and large parts of `mutation.clj`. One observable edge: `parse-duration-ms` on a malformed duration (e.g. `10x`) threw `NumberFormatException` at the pin (CLI crash), now silently defaults to `0`. Our caller always passes `1s`, so the edge is unreachable from our wrapper. Library semantics over our corpus: measured by section 2. |
| `db9818e69` | Clarify Babashka tools are primary | docs | ✓ docs only (README + spec .md files). |
| `55dc7e0aa` | Add help output to Babashka tools | help output | ✓ additive CLI surface: `-h`/`--help` + help text on all three CLIs. Positional contracts and exit codes (0 ok, 1 error, 2 usage) unchanged. |
| `1847a252e` | remove go tools | no-op for us | ✓ effectively — deletes `cmd/`, `internal/`, `go.mod` (we vendor bb only). Its `bb/src` edits are usage-string wording only (`usage: gherkin-…` → `usage: bb gherkin-…`). |
| `445efe487` | Document APS tool installation source | docs | ✓ README only. |
| `3a1d7b063` | Add default parameter inference to the Gherkin parser | **behavior change** | ✓ confirmed, and it is ON BY DEFAULT: `parse-file` 1-arity and the CLI both infer unless `--do-not-infer` is passed. New `aps.inference` namespace; literal step values become `pN` placeholders merged into example tables. This changes the IR every consumer reads (see §3). Also checked: candidate `write-json!` is UNCHANGED — byte-identical at both heads, and `strip-empty-keys` exists at both (pin `gherkin.clj:109-110`/`json.clj:23`; the candidate only refactors its internals into `strip-coll`/`keep-non-empty-entry` helpers). Any IR byte difference therefore comes from inference itself, not from stripping — and the matrix compares gate outcomes and finding sets, not bytes, by design. [Corrected per architect bounce D1, 2026-08-20: the first run of this report claimed the candidate "adds" the stripping step; verified false against the vendored pin copy.] |
| `1001283af` | Move gherkin mutation metadata to work dir | **behavior change** | ✓ confirmed, and it is bigger than a relocation: the candidate **stops writing the stamp/manifest into the feature file entirely**. `write-mutation-metadata!` writes `<work-dir>/metadata/<slug>.mutation.json` (stamp + manifest in one sidecar); in-feature metadata is read only as a legacy fallback, never written back. |

## 2. Verdict matrix (per corpus entry, per gate)

Corpus: every live `specs/features/*.feature` (604 files; `.feature.draft`
excluded by design) through (a) the lint-gate parse (each toolchain's own
parser CLI semantics + the real `gherkin_lint_gate_cli.bb` over the produced
IR — the exact two-step sequence `gherkin_lint_gate.sh` runs) and (b) IR
generation + the IR-DRY checker (verdict compares finding sets, not file
bytes); plus (c) the existing gherkin-mutation fixture
(`specs/pipeline/test/fixtures/mutation-wiring.feature`) through
mutation-site enumeration (`aps.mutation/discover` — enumeration only, no
mutation loop). The comparator fails closed: a missing outcome on either
side is INCOMPLETE with a non-zero exit, never equivalence.

**Run 1 — candidate at its CLI defaults (inference ON), 2026-08-20:**

| | rows | EQUIVALENT | DIVERGENT | INCOMPLETE |
|---|---|---|---|---|
| lint-parse (604 entries) | 604 | 572 | **32** | 0 |
| ir-dry (604 entries) | 604 | 311 | **293** | 0 |
| mutation-sites (fixture) | 1 | 1 | 0 | 0 |
| **total** | **1209** | **884** | **325** | **0** |

Comparator exit: 1 (fail closed on any divergence). Every divergence traces
to commit `3a1d7b063`'s default-ON inference:

- **10 lint-parse rows**: the candidate parser REJECTS live features the pin
  accepts — `missing example columns for explicit placeholders: <name>`
  (inference validates explicit placeholders; e.g. BL-106's `role`). These
  features would start failing `gherkin_lint_gate.sh` the day of a bare bump.
- **22 lint-parse rows**: the candidate parses, but OUR
  `gherkin_lint_gate_cli.bb` then fails the inferred IR — its
  phantom-Examples-column check no longer sees explicit `<placeholder>`
  references as step parameters (verified by hand on BL-957's feature:
  three "Examples column … is not referenced by any step parameter" hits
  that do not occur on the pinned IR).
- **293 ir-dry rows**: finding sets reshape under inference — literal step
  text becomes `<p1>` variants, flipping finding kinds (`near-duplicate` ↔
  `possible-synonym`), adding and removing findings (e.g. BL-097's one
  finding disappears). 10 of the 293 are downstream of the parser
  rejections above ("parser failed - no IR to analyze").
- **mutation-sites**: EQUIVALENT even with inference ON — `discover` is
  byte-identical across the two heads and the fixture's example tables are
  untouched by inference.

**Run 2 — the same candidate parsed with `{:infer? false}` (the
`--do-not-infer` shim), against the identical pinned result set:**

**All 1209 cells EQUIVALENT, comparator exit 0.** Every run-1 divergence is
inference-attributable, and `--do-not-infer` provably restores byte-level
gate equivalence for the whole live corpus — the shim in §4.1 is sufficient
for the parser-consuming surface, not just plausible. (Runner seam:
`APS_EQUIVALENCE_NO_INFER=1` parses via the candidate's `{:infer? false}`
arity — the exact IR the flag would give the gates.)

The full per-entry matrix is reproducible: run
`swarmforge/scripts/aps_equivalence_run.sh` (writes `matrix.txt` /
`matrix.md` into its work dir and exits 0 only on all-EQUIVALENT).

## 3. Entry-point compatibility (per local caller of swarmforge/vendor/aps)

| caller | invokes | candidate-compatible? | shim needed |
|---|---|---|---|
| `swarmforge/scripts/gherkin_lint_gate.sh` | `bb gherkin-parser <feature> <ir>` (2 positional), then our lint CLI over the IR | CLI contract: yes (positional args, exit codes unchanged). Behavior: **measured — 32 of 604 live features flip from pass to fail** under the candidate's default inference (10 parser rejections + 22 our-lint failures, §2) | **yes**: `--do-not-infer` — run 2 shows it restores full equivalence |
| `swarmforge/scripts/gherkin_lint_gate_lib.bb` | pure — consumes the IR | affected only via IR shape (above) | rides the same choice |
| `swarmforge/scripts/pre_qa_gate_gather_lib.bb` | checks vendor presence only (registry-load-error message) | yes | none |
| `specs/pipeline/runnerAdapter.js:21` | `bb gherkin-parser <feature> <ir>` in the vendor dir — the IR that generates EVERY acceptance entry point | CLI contract: yes. Behavior: **default-ON inference reshapes the IR feeding `generate.js`** — inferred `pN` parameters and merged example columns reach the generated tests and step matching | **yes**: pass `--do-not-infer` at bump time (flag exists on the candidate), or adopt inference deliberately as its own reviewed slice — never as a side effect of the bump |
| `specs/pipeline/scripts/run_gherkin_mutation.sh` | `bb gherkin-mutator --feature --work-dir --runner-worker --level --status-interval --json` | all flags preserved (verified against the candidate's option table). Behavior: metadata now lives in `<work-dir>/metadata/…` — our wrapper defaults `--work-dir` to a fresh `mktemp`, so **soft-level reuse silently stops working** (every soft run re-mutates everything; stamp never survives the run) | **yes**: give the wrapper a stable per-feature work dir (or persist the sidecar) before bumping |
| `specs/pipeline/{gherkinMutationOutcome,gherkinMutationManifest,scripts/finalize_gherkin_mutation}.js` | read/correct the stamp+manifest the mutator wrote **into the feature file** | **no** — the candidate never writes in-feature metadata again (sidecar-only; legacy blocks are read as fallback, left stale forever) | **yes**: port the correction/classification logic to the sidecar location, and decide a one-time cleanup for the legacy in-feature blocks |
| `specs/pipeline/mutationWorker.js` | consumes the worker-job JSON | yes — the `work_dir` job field exists on both sides | none |
| `swarmforge/scripts/install_aps_tools.sh` | vendors `bb.edn` + `bb/` | yes — both exist at the candidate head; `bb.edn` task names identical (`gherkin-parser`, `gherkin-ir-dry-checker`, `gherkin-mutator`, `test`) | none |

## 4. Recommendation

**bump-with-shims** — do not fast-forward the pin bare. The candidate is a
clean fast-forward and its CLI contracts are compatible, but two of the
seven commits change behavior our pipeline depends on, and both need a shim
IN THE SAME COMMIT as any bump:

1. **Inference (3a1d7b063)**: add `--do-not-infer` to the two parser call
   sites (`gherkin_lint_gate.sh`, `runnerAdapter.js`) so the bump is
   behavior-neutral for IR consumers. Measured stakes: a bare bump flips 32
   of 604 live features from lint-pass to lint-fail and reshapes 293
   IR-DRY finding sets (run 1); with the flag, the candidate is fully
   equivalent over the corpus (run 2 — 1209/1209 EQUIVALENT). Adopting
   inference (and any feature-authoring guidance it implies) is a separate
   reviewed slice, per the ticket's out-of-scope note.
2. **Mutation metadata relocation (1001283af)**: give
   `run_gherkin_mutation.sh` a stable work dir (or persist
   `<work-dir>/metadata/`) so soft-run reuse keeps working, and port the
   stamp/manifest reading in `finalize_gherkin_mutation.js` /
   `gherkinMutationOutcome.js` / `gherkinMutationManifest.js` to the
   sidecar. Without this the bump silently degrades every soft mutation run
   to a full one and strands the BL-638 false-clean correction logic.

The divergence list in §2 is the argument for everything above; §2's lanes
deliberately do not exercise the mutation LOOP (enumeration only), so the
metadata-relocation shim rests on the §1/§3 source analysis, not on a
matrix row.

Top three ways this evidence could be wrong (the intake's own challenge,
answered):
- The corpus lanes run each toolchain's parse/DRY through its library entry
  points in one process (mirroring each CLI's exact body and its own
  defaults) plus the real spawned lint CLI — a CLI-only regression in arg
  handling outside those bodies would not surface in §2; §1/§3 cover that
  surface by source diff instead.
- Mutation-site enumeration covers one fixture, not every Scenario Outline
  in the corpus — a discover() divergence conditional on an example shape
  absent from the fixture would hide.
- "Legacy fallback reads old in-feature manifests" is source-verified but
  not exercised by the matrix; if the fallback misparses our real blocks,
  soft-reuse breaks in a way only a live mutation run would show.

— By coder (BL-959), 2026-08-20.
