# BL-835 — architect review pass — bounce, 2026-08-06

**Verdict: BOUNCE (1 defect).** Architecture, dependency-gate, co-change,
invariants, and property-coverage checks are all clean on this delta. One
lineage/audit-trail defect found and blocks forward.

**Commit reviewed:** `5306a43265` (cleaner tip; merges coder's `09b521c5`
fix on top of the previously-reviewed `92298b222d` architect pass).

## Inventory

**D1 — coder's bounce-fix commit does not carry documenter's bounce commit
as an ancestor; the bounce audit trail was silently dropped**

- **class:** behavior (process/lineage defect, not a functional-behavior bug)
- **blamed role:** coder
- **remediation pointer:** merge commit `2ce6cb5b` (coder's "Merge documenter
  (bounce, hardener tip 8cca02bc74)") and its child `09b521c5` (the
  required_wiring text fix)

Documenter bounced BL-835 to coder for the required_wiring literal-text
mismatch, reverting the hardener merge on its own branch and committing bounce
evidence at `c4227f7c` (`backlog/evidence/BL-835-flow-watchdog-floored-percentile-false-alarms-bounce-20260806.md`),
per "A Bounce Must Be Reverted Out Of The Bouncing Branch."

Coder's merge commit `2ce6cb5b` claims in its message to merge documenter's
bounce ("Merge documenter (bounce, hardener tip 8cca02bc74)"), but its actual
parents are `17ba35e7` and `8cca02bc` — **not** `c4227f7c`:

```
$ git log -1 --format="%H %P" 2ce6cb5b
2ce6cb5b... 17ba35e71e9de4fab6499ba457550dbb59413e6e 8cca02bc74ae346fb4610dc01d2a90ae0fec28ee

$ git merge-base --is-ancestor c4227f7c 09b521c5 && echo YES || echo NO
NO
```

Per "Forwarded Commits Carry Their Lineage": "the commit you forward MUST
have the received commit as an ancestor... The receiving role re-runs the
same check and refuses parcels that fail it." The check fails. The concrete
loss: documenter's bounce-evidence file never reaches this branch (confirmed
absent from `5306a43265`'s tree), so the historical record that BL-835 was
ever bounced by documenter — and why — will never reach `main`. A future
`main`-ref bounce-history check (the QA rule "A Prior QA Bounce Is Not In
Your Worktree") would find nothing for this bounce.

**Why this matters beyond bookkeeping:** the functional fix itself is
correct (verified separately, not blocked) — the risk is precedent. The
"revert-then-bounce" pattern documenter used is correct branch hygiene *for
documenter's own branch*, but it means a literal `git merge <bounce-tip>` by
the receiving role would destructively re-apply that revert and strip
hardener's legitimate work (`threshold-table-stale?` / round-trip tests) —
confirmed by inspecting the merge-base: `8cca02bc` is the base on both sides,
and documenter's side removed hardener's content relative to it, so a naive
3-way merge silently takes the removal. Coder appears to have (correctly)
avoided that destructive merge by fixing forward on hardener's tip instead —
but in doing so, dropped the evidence file that should have survived
alongside the correct choice to keep hardener's work. Both properties are
achievable at once; the merge just needs one more step.

**Remediation:** record documenter's bounce as a real ancestor without
losing hardener's content:

```sh
git merge -s ours --no-commit c4227f7c
git checkout c4227f7c -- backlog/evidence/BL-835-flow-watchdog-floored-percentile-false-alarms-bounce-20260806.md
git add backlog/evidence/BL-835-flow-watchdog-floored-percentile-false-alarms-bounce-20260806.md
git commit  # records c4227f7c as a real parent; -s ours keeps current tree otherwise unchanged
```

Confirm afterward: `git merge-base --is-ancestor c4227f7c HEAD` → YES, and the
evidence file is present on disk, and `bb swarmforge/scripts/test/flow_watchdog_test_runner.bb`
still reports `ALL PASS` (no functional content should change from this step).

## Other checks in this pass (all clean, not blocked by D1)

1. **Dependency-rule gate** — N/A. This delta touches only
   `swarmforge/scripts/test/flow_watchdog_test_runner.bb` and a
   `backlog/evidence/*.md` file, both outside `extension/src`/`extension/media`;
   confirmed the tool itself runs (node 22 via nvm; the repo's default node 20
   is below dependency-cruiser's floor, an environment quirk unrelated to this
   parcel) and correctly cannot resolve either path.
2. **Co-change** — ran against the changed test file; same pre-existing,
   documented `flow_watchdog_lib.bb`/`handoffd.bb` sibling coupling as my prior
   pass. No new coupling introduced (no production file changed in this delta).
3. **Invariants review** — all three declared invariants concern
   `thresholds-from-samples`/`decide-tier`/`resolve-thresholds`, none of which
   changed in this delta (production code untouched; only test assertions and
   test coverage added). Already confirmed via property runner in my prior
   pass; nothing new to re-verify.
4. **Property-testing pass** — hardener's two new test blocks
   (`threshold-table-stale?` boundary, `read`/`write-threshold-table!` round
   trip) are exactly the round-trip/boundary shape this pass looks for, added
   as example-based unit tests (no fast-check-equivalent property framework is
   wired for Babashka) with a documented break-then-fix mutant proof in the
   hardener's own evidence. Sufficient; no gap to add to.
5. **Correctness read of the new production-adjacent test targets**
   (`threshold-table-stale?`, `read-threshold-table`, `write-threshold-table!`
   in `flow_watchdog_lib.bb`) — read directly; logic is correct (string/keyword
   spec-key normalisation round-trips cleanly, boundary comparison in
   `threshold-table-stale?` is `>=` matching its own docstring). No defect.
6. **Test suite** — `bb swarmforge/scripts/test/flow_watchdog_test_runner.bb` →
   `ALL PASS` on the merged tree.

## Blocked checks

None — every check above ran to completion; D1 does not block any of them.
