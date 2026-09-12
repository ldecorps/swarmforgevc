# BL-1545 - specifier reproduction of the coder's unowned-red note (2026-09-12)

Inbound: coder `note` (priority 00, 2026-09-12 00:15Z, from the BL-1544
parcel): "unowned-red: test_bl1374_sync_merge_passengers.sh cases 01/05
misattribute path". Coder evidence: `.worktrees/coder/backlog/evidence/
BL-1544-coder-20260912.md` lines 105-115.

## Reproduced on main dbcab2ffb2

```
$ bash swarmforge/scripts/test/test_bl1374_sync_merge_passengers.sh
  FAIL 01: the passenger file is not this ticket's own path (unexpectedly found 'shared.txt')
  FAIL 05: the passenger's own ticket still owns its file (missing 'BL-1296')
test_bl1374_sync_merge_passengers: 2 FAILURE(S)
```

The other 15 checks pass. `bl1374_sync_merge_passengers_property_runner.bb`:
ALL PROPERTIES HOLD (24 fixture runs). The BL-1374 feature file is red with
it: `bl1374SyncMergePassengersSteps.js` spawns this shell test and throws on
a non-zero exit, so all four scenarios fail.

## Neither case is a misattribution - both are stale oracles

### Case 01 - the oracle greps the whole printed map

Raw `own-paths` answer for the case-01 fixture at HEAD:

```
OWN-PATHS {:paths ["own.txt"], :warning nil, :passengers #{},
           :excluded [{:path "shared.txt", :owners #{"BL-9003" "BL-9002"}}],
           :content-clear []}
```

`:paths` is `["own.txt"]` - the passenger file is NOT delivered; BL-1374's
narrowing holds. `shared.txt` appears only inside `:excluded`, the report
key BL-1389 added (`06f1babcaf`, 2026-09-04 16:07, land_step_lib.bb lines
1253 / 1877; printed by land_step_cli.bb line 167 as EXCLUDED_SIBLING_PATH).
The test's `absent "01: ..." "$(sed -n 's/^OWN-PATHS //p')" "shared.txt"`
greps the WHOLE map for the substring, so the report of an exclusion reads
as a delivery. Walked every land_step_lib.bb / pipeline_stage_lib.bb commit
since BL-1374's self-audit 7b5945e947 in a scratch worktree: case 01 is
`ok` at 9121b628c9 (BL-1385) and `FAIL` from 06f1babcaf (BL-1389) onward,
at all 15 later commits.

### Case 05 - the base is read from the LIVE origin/main

Case 05 calls `path-owner-tickets root (origin-main-sha root) "522584ed85"
<BL-1296 yaml>`. The tip `522584ed85` is pinned; the base is whatever
`origin/main` points at today. `git rev-list --count origin/main..522584ed85`
is 0 - origin/main has absorbed the tip - so the walk finds no commit and:

```
om = dbcab2ffb2 (live origin/main):  {:owners #{}, :any-untagged? false}
om = 3ea55a2e46 (5d4486eb08^2, the sync merge's main-side parent):
                                     {:owners #{"BL-1296"}, :any-untagged? false}
```

With the base pinned where it stood at the sync, the CURRENT lib answers
BL-1296 alone - the narrowing still works. Against the live base the
`contains BL-1296` check fails and the two `absent BL-1309 / BL-1328` checks
pass VACUOUSLY (BL-1445's shape: a census of zero goes green). QA ran this
case green on 2026-09-04 (`BL-1374-qa-pass-20260904.md`, "18 checks,
including the live 5d4486eb08 regression"); it went red when origin/main
advanced past the tip, which no lib commit caused and no lib commit can fix.

### Fixture-root escape observed during this reproduction

`git bisect run` exports `GIT_DIR=<repo>/.git/worktrees/<wt>` into the run
script (verified: `git bisect run sh -c 'env | grep ^GIT_'`). The test's
fixture builders run `git -C "$root" init/add/commit/checkout -b tA/merge`
with no BL-1390 root proof and with stderr silenced, so under that
environment every fixture command operated on the bisect worktree's
repository: the worktree's HEAD became fixture commit `aea94c41ed` ("BL-9001:
own edit to the shared file") and a branch `tA` appeared in the LIVE
repository's refs (linked worktrees share refs). The specifier deleted the
stray branch (`git branch -D tA`, no other ref contained the commit) and
reset the scratch worktree; `main` and every role branch were untouched.
This is BL-1516's class (paused, systematic census); this ticket adds the
proof to the one file it edits anyway.

## Ownership

- No row in `backlog/standing-reds.tsv` names either file; no open ticket
  names the test (grep of active/paused/hold). BL-1374 and BL-1389 are done.
- BL-1544 (active, coder) edits land_step_lib.bb's subject attributor -
  a different site; the coder confirmed the red persists with its change
  stashed. BL-1467 (paused) also edits land_step_lib.bb. This ticket edits
  only the shell test: orthogonal by path to both.
- first_seen 2026-09-04: BL-1389 landed at 16:07 that day (case 01); QA's
  green run of case 05 is dated the same day, so the file's first red is
  no earlier than 2026-09-04 whichever case tripped first.
