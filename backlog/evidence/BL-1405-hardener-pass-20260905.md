# BL-1405 — hardener pass, 2026-09-05

Ticket: BL-1405-hand-built-land-records-approval
Commit reviewed: 4c5ddcc9ad (cleaner) / 7d5a572746 (architect, NONE pass)

## Result: NONE — no defect found; BL-113 mutation clean (2/2 killed); one
   probed behavior confirmed as ticket-anticipated, not a gap

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `bash swarmforge/scripts/test/test_record_land_approval_cli.sh` | 5/5 |
| `bb swarmforge/scripts/test/bl1405_hand_built_land_records_approval_property_runner.bb` | ALL PROPERTIES HOLD, 300/300 each of P1/P2, coverage `{:p1-shared-commit-diff-source 240, :p2-invalid-commit 141, :p2-invalid-source 159}` |
| `node specs/pipeline/cli.js specs/features/BL-1405-...feature` | 5/5 scenario runs |
| `bash swarmforge/scripts/test/test_land_step_records_approval.sh` (BL-1334 regression) | ALL CHECKS PASSED |
| `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` (regression) | ALL PASS, unaffected |
| `bl1405HandBuiltLandRecordsApprovalSteps.js::registerSteps` present | yes (required_wiring) |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after).

## BL-113 soft gherkin mutation (one Scenario Outline, 2 examples)

Ran `specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1405-a-hand-built-land-records-its-land-approval.feature
<fresh mktemp under ./tmp> specs/pipeline/steps/index.js soft` (all 4
positionals explicit, workdir removed after). Result: **2 mutants, 2
killed, 0 survived** (the `<missing>` example cells, single-letter case
flips) — clean. Manifest stamp committed alongside this evidence.

## Probed and confirmed non-issue: different-length sha representations of
   the same commit are not deduped against each other

Since this CLI is explicitly for a HUMAN hand-typing shas (the "hand-built"
land recipe), I probed whether recording the same commit twice with
DIFFERENT-length sha strings (a full 40-char sha, then an 8-char
abbreviation of the identical commit) produces one line or two. Verified
live against the real CLI and a real fixture repo:

```
$ bb record_land_approval.bb $D $FULL $SRC BL-TEST1
LAND_APPROVAL_RECORDED 16632f3fdf <- 5dd3161ad8 (BL-TEST1)
$ bb record_land_approval.bb $D "${FULL:0:8}" "${SRC:0:8}" BL-TEST1
LAND_APPROVAL_RECORDED 16632f3f <- 5dd3161a (BL-TEST1)
$ cat $D/.swarmforge/land-approvals/*.jsonl
{"...","commit":"16632f3fdf","source":"5dd3161ad8",...}
{"...","commit":"16632f3f","source":"5dd3161a",...}
```

Two lines, not one. At first glance this looks like the same class of
undertested boundary BL-1407's own hardening pass found — but the ticket's
own text explicitly anticipates and accepts exactly this: "Recording twice
for the same replay is harmless and idempotent **at the predicate** (first
matching line wins); the CLI **may skip an exact duplicate line**." The
qa_e2e procedure's own dedup scenario (item 5 / acceptance scenario 04)
is scoped to "the same arguments" — an EXACT-string duplicate, not a
commit-identity one. Both declared invariants hold regardless: invariant 1
(one writer, no second serializer) is unaffected — both lines were written
by the identical writer in the identical shape; invariant 2 (a record
grants nothing on its own) is unaffected — the predicate still requires
the named source to be independently approved, whichever line it matches
first. The extra line is inert clutter, not a correctness or security gap,
and closing it (normalizing every sha to its canonical full form via `git
rev-parse` before truncating) would be a scope expansion beyond what this
ticket asks for, not a hardening fix to a declared invariant.

Recorded here, not chased with a test, for the same reason BL-1422's
git-timestamp finding was recorded rather than "fixed": the behavior is
already named and accepted in the ticket's own text.

## Design/CRAP/DRY

No production code changed by this pass. Babashka has no mutation/CRAP/DRY
tooling wired (BL-472 deferred, cleaner already recorded this fallback);
gated by the unit/property/acceptance suites above plus the clean BL-113
gherkin-mutation pass.

## Verdict

No defect. Forwarding unchanged (plus the committed mutation-manifest
stamp) to documenter.
