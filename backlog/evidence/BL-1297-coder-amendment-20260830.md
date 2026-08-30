# BL-1297 — coder rework after the in-flight spec amendment, 2026-08-30

Inbound: specifier `note`, priority `00` — "BL-1297 amended 91daff4f08: merge
main, re-read. Scen 05/06 need handlers". Merged `main` (and `origin/main`,
which was identical — `rev-list --left-right --count main...origin/main` = 0/0)
before reading anything, per the amend-in-flight rule.

The amendment is recorded in `backlog/evidence/BL-1297-spec-correction-20260830.md`:
the first version of this contract asked ONE question for three callers, and
that answer refused every forward in the pipeline the moment a branch had
synced main — which is always. No workmanship bounce was charged, and none is
claimed here.

## 1. What changed in the code

`own-commit-changed-paths` now answers under one of TWO semantics, chosen by
the caller, and identical everywhere except on a merge:

| semantic | invocation | a clean receive-merge answers |
|---|---|---|
| `:delivered` (default) | `diff-tree --no-commit-id --name-only -r <c>^1 <c>` | everything the merge brought in |
| `:authored` | `diff-tree --no-commit-id --cc --name-only -r <c>` | `[]` |

The split lives in the shared helper, not at the three call sites, so no
caller can invent a third question. `task-tagged-changed-paths` gained a
5-arity carrying the semantic; its 4-arity still means `:delivered`, which is
the shape `land_step_lib.bb`'s `own-paths` and its `diff-readable?` probe
already depend on. `parcel-own-changed-paths` — the single seam BOTH
send-time gates share — now asks `:authored`.

`--cc` was chosen over `-m` for `:authored` for the reason the ticket gives:
`-m` unions the per-parent diffs and attributes the merged-in branch's work to
the merging role. Measured on this repository's own shapes: on a single-parent
commit `--cc` degrades to the ordinary diff (so scenarios 04 and 06 are true
at once); on a clean merge it prints nothing; on an evil merge it prints
exactly the merge's own resolution. A ROOT commit has no parent at all, so
`--root` is applied under both semantics — every path in it is both delivered
and authored, and answering nothing there would pass the gate open exactly as
the merge blind spot did.

## 2. Scenarios 05 and 06 — handlers in the SAME parcel as the amendment

Per BL-233 (and the note the specifier attached), a scenario whose handler has
not landed turns the acceptance suite red for every other parcel, so the
handler edits and the amended feature travel together.

- **05** — a clean receive-merge carrying other tickets' landed work is NOT
  refused. New `mergeParcelIn`-based Given, plus a `the merge resolved no path
  itself` step that asserts `:authored` is `[]`, and `the handoff is not
  refused`. The Given ALSO asserts the foreign path really is delivered — a
  "not refused" that passed because nothing was there would prove nothing.
- **06** — delivered and authored agree on a single-parent commit, and agree
  on something rather than on nothing.
- **02 (amended)** — the fixture is now an EVIL merge, built with `merge
  --no-ff --no-commit` and a resolution written into the merge itself. Its
  Given asserts that the resolved path is the only authored one, so the
  refusal below cannot be true for the `:delivered` reason the amendment
  removed.
- The `When` shared by 01/04 was renamed to `the commit's delivered paths are
  computed` to match the amended feature text.

`specs/pipeline/scripts/run_acceptance.sh
specs/features/BL-1297-a-merge-commits-own-paths-are-not-empty.feature`
— **6 scenarios, 6 pass, 0 fail**.

## 3. Declared invariants (BL-654) — all three executable, all rewritten

`extension/test/bl1297MergeOwnPathsInvariants.property.test.js`,
`npm run test:properties` lane. **3 properties, 3 pass.**

Invariant 2's old property asserted the three callers "answer identically".
That is the premise the amendment overturned, so it was replaced rather than
patched: invariant 2 is now purely "empty is the truth, never an artefact",
and invariant 3 is the new assertion that the callers deliberately DIFFER.

Generator reach is constructed, not hoped for. A sixth shape, `evil-merge`,
was added — it is the ONLY merge whose author wrote anything, so without it
"authored is empty exactly when the merge resolved nothing" would be
satisfiable by a implementation that always answers empty for a merge. Every
shape runs outright before any random draw, and each property asserts its own
floor:

- invariant 1: all six shapes reached; at least two clean merges; at least one
  evil merge.
- invariant 2: a genuinely empty delivered set, a genuinely empty authored
  set, and a non-empty authored set each produced at least once.
- invariant 3: at least one case where the gates SEE a test file (authored),
  and at least one where the land step sees it and the gates must NOT
  (delivered only). Without the second floor every row could pass with both
  callers reading the same answer — the contract this amendment replaced.

One oracle bug found and fixed while writing it: the first version checked
`raw.includes(TEST_FILE)` over the whole printed map, which now finds the path
in `:land` and passes for the wrong reason. It reads the gate's own
`:unreg-files` (basenames) instead.

## 4. Non-vacuity — two deliberate breaks, run and restored

| deliberate break | bb unit rows | properties |
|---|---|---|
| gates read `:delivered` (the over-correction the amendment repairs) | 1 FAIL (s05) | invariant 3 FAIL |
| `--cc` dropped from `:authored` | 4 FAIL (s02, s06) | all 3 FAIL |
| none | ALL PASS | 3 of 3 pass |

The first break is the one that matters here: it is exactly the shape that
shipped and blocked this ticket's own forward, and only invariant 3 and unit
row s05 catch it.

## 5. Blast radius — every caller's own suite, run

| suite | result |
|---|---|
| `task_scope_gate_lib_test_runner.bb` | ALL PASS |
| `land_step_lib_test_runner.bb` | ALL PASS |
| `unregistered_test_gate_lib_test_runner.bb` | ALL PASS |
| `bl1240_unregistered_test_gate_property_runner.bb` | ALL PASS |
| `task_scope_gate_acceptance_exemption_property_runner.bb` | ALL PASS |
| BL-1295 property test (neighbouring fixture) | 3 of 3 pass |
| BL-1295 feature | 3 scenarios, 3 pass, 0 fail |

BL-1295's fixtures were repaired in the previous coder pass by moving the walk
base past the task's own earlier merge. Under `:authored` that base shift is
no longer load-bearing for the gate, but it is still correct and both remain
green, so nothing was reverted to chase tidiness.

## 6. required_wiring

`specs/pipeline/steps/index.js::bl1297MergeCommitOwnPathsSteps` — parsed back
with `pre-qa-gate-lib/read-required-wiring` (arity-1, over the ticket YAML
content) rather than eyeballed: the field is `[:present? true]` with the entry
intact and unwrapped, and the anchor is at `specs/pipeline/steps/index.js:656`.

**One stale detail for the specifier, not fixed here:** the entry's reason text
still says "the FOUR scenarios must actually run". There are now six. The
anchor — the part the gate matches — is unaffected, and the ticket contract is
the specifier's to edit, so it is surfaced rather than amended by me.

## 7. Not done here

`land_step_cli.bb` was not re-run against BL-1272's or BL-1295's real
landings; those are QA's own step on QA's branch, and BL-1298 would confound
the result. The standing bb suite runner is itself red for an unrelated
reason (a stray property-runner row) and was not used as the gate — every
suite above was invoked directly instead.

By coder.

---

## 8. Self-audit findings (handoff audit challenge), fixed in `1a` below

The audit challenge was answered by re-reading the inbound note, the amended
ticket, the amended feature, and the committed diff, then enumerating EVERY
caller of the shared walk rather than the three the ticket names:

```
grep -rn 'own-commit-changed-paths\|task-tagged-changed-paths\|parcel-own-changed-paths' \
     --include='*.bb' --include='*.sh' .   # excluding tests
```

Five live call sites, all accounted for: three in `land_step_lib.bb`
(`diff-readable?`, `landed-siblings`' default walk, `own-paths`), one in
`unregistered_test_gate_lib.bb` via the shared seam, one at the gate site.
No sixth consumer, and no shell script reaches the walk directly.

**D1 — the land step's semantic was IMPLICIT.** All three of its call sites
took the helper's 4-arity/2-arity default. That is not "each caller reads the
question its own decision needs" (invariant 3); it is each caller inheriting
whatever the helper happens to default to. The failure it leaves open is
precisely the one the ticket's own re-triage warns about: point the default at
`:authored` and the replay is handed an empty set and reports "nothing to
commit" — this ticket's defect, arriving from the other side, with nothing in
`land_step_lib.bb` to notice. Fixed: `:delivered` is now passed explicitly at
all three sites, with the reason stated where a future reader will meet it.
Behaviour is unchanged (the default already was `:delivered`), so no test
result moves; invariant 3's property already pins `land` to the delivered set,
which is what keeps the explicit choice honest rather than decorative.

**D2 — stale comments in `land_step_lib.bb`.** Four comments described the
shared walk as answering ONE question ("the same contract
task-tagged-changed-paths uses"). Under the amendment that reads as an
instruction to make the two agree, which is the mistake being repaired.
Corrected in place; the nil-vs-empty half of that contract, which the split
left untouched, is now called out as the part that IS still shared.

**Checked and found clean, no change needed:**
- `the two answers are identical` is also a BL-1097 step. Both are
  `defineScoped` to their own feature, so there is no collision — verified by
  running BL-1097's feature too: **4 scenarios, 4 pass, 0 fail**.
- No feature file still uses the renamed `the commit's own changed paths are
  computed`.
- Article 4.5: the one production path this parcel changes,
  `swarmforge/scripts/task_scope_gate_lib.bb` (and now
  `land_step_lib.bb`), is covered by registered runners that were run above.
  No NEW test file is introduced, so the unregistered-test gate has nothing
  new to register.
- Working tree carries one untracked file this parcel did not create,
  `swarmforge/scripts/wait_pipeline_drain.sh`. It is NOT staged and NOT
  swept — surfaced here for whoever owns it.

### Re-run after the audit fixes

| suite | result |
|---|---|
| `task_scope_gate_lib_test_runner.bb` | ALL PASS |
| `land_step_lib_test_runner.bb` | ALL PASS |
| `unregistered_test_gate_lib_test_runner.bb` | ALL PASS |
| `bl1240_unregistered_test_gate_property_runner.bb` | ALL PASS |
| `task_scope_gate_acceptance_exemption_property_runner.bb` | ALL PASS |
| BL-1297 feature | 6 pass, 0 fail |
| BL-1097 feature | 4 pass, 0 fail |
| BL-1297 properties | 3 of 3 pass |
| BL-1295 properties | 3 of 3 pass |
