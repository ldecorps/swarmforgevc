# BL-1192 architect bounce — 20260828

Reviewed cleaner handoff `b033583c08` (merged `9f99cdcff`) for BL-1192
(pre-handoff task-scope gate). Dependency gate and co-change report show
nothing new attributable to this parcel (the reported acyclic violation
belongs to the pre-existing BL-726 family, confirmed via
`grep -rl BL-726 backlog/`). Unit suite is green
(`task_scope_gate_lib_test_runner.bb`: ALL PASS) and acceptance ran 7/7
per the cleaner's evidence. Sending back on one design/correctness defect
found while checking whether the gate would actually catch the incident
it is modeled on.

## D1 — scope choice explodes into false-positive avalanche on this repo's real git topology (blame: coder, class: behavior)

The ticket's `description` specifies the mechanism explicitly: "Compare
`git diff --name-only origin/main...<commit>`." The implementation
(`task_scope_gate_lib.bb`'s `findings-for-git-handoff`) instead diffs the
cited commit against its own first parent only
(`git diff-tree --no-commit-id --name-only -r --first-parent commit`),
citing BL-953's precedent as justification. That precedent does not
transfer: BL-953 probed live hashes and found even a *merge's
second-parent-side* range too wide, and landed on commit-*subject*-only —
a far narrower check than "this one commit's own file diff."

Verified directly against the actual historical commit BL-1192 is modeled
on — the documenter tip `dd5b4c332` that produced the real BL-1174 QA
bounce (`backlog/evidence/BL-1174-qa-bounce-20260827.md`):

```
bb -e '(load-file "swarmforge/scripts/task_scope_gate_lib.bb")
       (require [(quote task-scope-gate-lib) :as g])
       (let [r (g/findings-for-git-handoff
                 {:root "." :task-name "BL-1174-x" :commit "dd5b4c332"})]
         (println (count (:findings r)))
         (println (distinct (map :ticket-id (:findings r)))))'
```

Result: **68 findings across 25 unrelated tickets**
(BL-1023, BL-1084, BL-1164, BL-1166, BL-1167, BL-1173, BL-1175, BL-600,
BL-601, BL-602, BL-726, BL-744, BL-754, BL-779, BL-784, BL-1176..BL-1185),
not the single clean "BL-1185 is entangled" signal the ticket's own
scenario-02 acceptance criterion describes ("the refusal reports the
foreign ticket id... lists at least one conflicting path"). BL-1185 is in
there, but drowned in 24 other tickets' routine backlog-YAML churn that
had already landed on "local main" (this repo's normal long-lived-branch
drift ahead of `origin/main` — the same shape I just merged as
`b033583c08`, whose own `origin/main...commit` diff is 64 paths across
~6 tickets, confirmed by direct `git diff --name-only origin/main...b033583c08`).

Armed at every hop as this ticket requires, the gate as implemented would
refuse the large majority of real handoffs in this repo — any cited
commit sitting on a branch that has not synced with `origin/main`
recently, which is the norm here, not the exception (see e.g.
`local-main-lags-origin-check-before-bookkeeping`,
`property-suite-full-run-hijacks-role-branch-refs` operator memory). That
is a worse outcome than the ten `behavior` bounces this ticket exists to
prevent: instead of reducing QA bounces, it stalls the pipeline at every
stage.

**Remediation:** either implement the ticket's literal
`origin/main...<commit>` range and solve the accumulation problem some
other way (e.g. scope positive matches to paths introduced since the
task's own most recent ancestor handoff, not since `origin/main`), or —
if a narrower scope is kept — first prove empirically, the way BL-953's
own comment documents doing, that the chosen scope does not explode
against real accumulated-branch commits in this repo. The check above
already falsifies that for the exact motivating incident, so first-parent
single-commit scope cannot ship as-is.

## D2 — acceptance fixture cannot distinguish the two ranges (blame: coder, class: invariant-unencoded)

`bl1192TaskScopeGateCli.sh` always sets
`origin/main := HEAD~1` of the cited commit (`git update-ref
refs/remotes/origin/main "$(git rev-parse HEAD~1 ...)"`). Every scenario
in the feature therefore has `origin/main...<commit>` and
`<commit>`'s own first-parent diff be the *same* diff by construction —
the fixture can never produce the multi-commit-drift shape that D1 shows
breaks the gate in practice. 7/7 green acceptance runs are not evidence
the implemented range is correct; the suite is structurally blind to the
one axis this ticket's own `description` specifies. Fix: give the fixture
an `origin/main` several commits behind the cited commit (accumulating
unrelated already-committed ticket paths in between, mirroring the real
`dd5b4c332`/`b033583c08` shape) in at least one scenario, so the range
choice is actually exercised.

By architect.
