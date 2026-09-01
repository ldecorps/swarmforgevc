# Specifier ruling — BL-925 invariant-2 red, and BL-1303's merge-path scenario
2026-08-31

Two decisions were routed to the specifier by the coder in
`backlog/evidence/BL-1303-coder-merge-path-20260831.md` (items 2 and 3),
delivered as a priority-10 `note` ("BL-925 red revealed in
test_pipeline_code_on_main_guard.sh; see evidence file"). Both adjudicated
here. Neither required an amendment to BL-1303.

## Item 2 — the BL-925 invariant-2 red: OVER-BROAD ASSERTION, not drift

**Ruling: the assertion is wrong; handoffd.bb is not.** Ticketed as **BL-1314**
(`backlog/paused/BL-1314-invariant-two-assertion-scoped-to-the-qa-question.yaml`,
`severity: high`, `depends_on: [BL-1303]`). handoffd.bb is not to be changed.

### What was measured

`swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh` pins invariant 2
with two greps. The bash half is scoped to the question; the Babashka half is
not:

    :378  grep -q 'merge-base.*--is-ancestor.*swarmforge-QA' "$GUARD"    && fail
    :380  grep -q '"merge-base".*"--is-ancestor"'            "$HANDOFFD" && fail

The second matches any ancestry call in handoffd.bb, whatever refs it is about.
Both hits on `main` today (read from the master checkout, `main`, clean):

    :3161  master-main-origin-is-ancestor?
           ["git" "merge-base" "--is-ancestor" "origin/main" "HEAD"]
           master/main reconcile — added by BL-1130, a3c4429c42, 2026-08-25

    :3357  git-is-ancestor? [dir ancestor descendant]
           generic; sole caller :3380 `:can-ff? (git-is-ancestor? wt head landed)`
           post-QA branch sweep — added by BL-668, f5b6b49f1f, 2026-08-26

Neither names `swarmforge-QA`. Neither asks whether a commit is a QA-approved
tip.

### Why that means the invariant holds

BL-925's own invariant 2, verbatim from
`backlog/done/M8/BL-925-reconcile-merge-of-qa-published-tip-completes.yaml:18`:

> There is one definition of `QA-approved tip` in the repo. A second predicate
> that answers the same question differently is the defect, not the fix.

The test is *the same question*, not *the same git subcommand*. handoffd.bb
answers that question in exactly one place — `qa-ancestor?` at :2789, shelling
to `is_qa_ancestor.sh`, the same script `check_pipeline_code_on_main.sh` calls
(`grep -c is_qa_ancestor swarmforge/scripts/handoffd.bb` → the call at :2789
plus its comment at :2770). There is no second predicate. The extraction BL-925
performed is still in place and still shared.

### Why it stayed invisible for six days

The assertion is at :380 of a file that has been aborting at case 01 since
BL-1252 moved pre-commit's guards behind `run_commit_guards.sh` without adding
that file to the fixtures. The assertion has been false since 2026-08-25
(BL-1130) and was never evaluated. The coder's fixture repair inside BL-1303
produced the first complete run in days, which is what surfaced it. That is
also why BL-1314 must promote *after* BL-1303 lands — same file, and the test
is not runnable end to end without the repair.

### What was rejected, and why

Tightening handoffd.bb instead. Routing `origin/main`-versus-`HEAD` through
`is_qa_ancestor.sh` would be a real defect: that script answers only the
swarmforge-QA question and, since BL-952, also folds in bounce detection, which
is meaningless for both other call sites. The broader "one ancestry primitive
for every ref pair" reading is coherent but is a new rule rather than invariant
2, so it is carried to the human as `ruling_options` option 2 on BL-1314 rather
than decided here.

### Known limitation, stated not engineered around

Scoping the grep to `swarmforge-QA` cannot catch a re-inlined call that binds
the ref to a variable — and neither can the bash sibling, today. That limit is
recorded in BL-1314 to be written into the test comment. An allowlist of
handoffd.bb's legitimate ancestry calls was explicitly rejected: hand-enumerated
membership rots (BL-973's four dead fixtures) and would fail again on the next
helper added for a third unrelated question.

## Item 3 — BL-1303 has no merge-path acceptance scenario: NO CHANGE

**Ruling: no scenario, no amendment to BL-1303, no note to its holder.**

The merge path is already covered executably, twice over: by the coder's new
`test_pre_merge_commit_hook.sh` cases 01/03/09, and by BL-632's acceptance
feature, which drives a real `git merge --no-ff` through the real hook. A
scenario would add a third assertion of the same behaviour behind a slower
harness.

Against that, the cost is concrete. Adding scenarios to an in-flight ticket
requires their step handlers in the same parcel or the runner hard-fails on
every one of them (BL-233), and BL-1303 is already past the coder — it was
forwarded to the cleaner at priority 50. An amendment landing now is the BL-971
shape exactly: a parcel built correctly against the contract as it stood,
stranded by the specifier's timing rather than by its workmanship. Not worth it
for coverage that already exists.

`qa_e2e_procedure` step 6 remains the manual check, as written.

## Item 1 — fixture rot repaired inside BL-1303

No specifier action. The coder repaired three dead fixtures
(`bl632CommitTimeGuardInvariants.property.test.js`, BL-632's acceptance
feature, and this guard test) because all three drive the hook BL-1303 changes,
and documented the repair. Recorded here only so the BL-1252 origin is not
re-diagnosed from scratch later.
