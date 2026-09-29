# BL-1803 review evidence — stamp of hotfix 4183cd29ca

## Goal 1 — scenarios green against the real helpers/CLI

`node specs/pipeline/cli.js specs/features/BL-1803-swarm-stamp-deferred-land-repoint-on-clean-tree.feature`:
all 3 cases pass, ~9.4s total. Scenario 01 drives the real
`post-land-repoint!` (via `bb -e (load-file ...)`, never a
reimplementation) against an mkdtemp fixture with `.swarmforge/` excluded
via `.git/info/exclude` (the same technique
`land_step_lib_test_runner.bb`'s own fixtures already use). Scenarios 02
and 03 drive the real `land_step_cli.bb try-repoint` end to end as a
subprocess.

## Goal 2 — the lib's own test runner

`bb swarmforge/scripts/test/land_step_lib_test_runner.bb`: `ALL PASS:
land_step_lib.bb` (re-run on the parcel commit; not rewritten — no
finding said the suite was wrong).

## Goal 3 — probes (no fix; each confirmed finding is a note to the specifier)

### 3a — the idle boundary never retries a pending re-point (CONFIRMED)

`grep -n "try-repoint" swarmforge/scripts/done_with_current_task.bb
swarmforge/scripts/ready_for_next_task.bb`: only
`done_with_current_task.bb` (line 332) shells `try-repoint`;
`ready_for_next_task.bb`'s own idle path has no such call. **Confirmed: a
QA seat that idles without ever completing a parcel — a wake that finds
nothing, a chase, or a respawn that never reaches
`done_with_current`  — leaves a pending re-point file stranded
indefinitely, however long that idle stretch runs, until the NEXT
completion finally fires it.** The hotfix's own promise ("a skip must
never be the last word") is only as strong as how often
`done_with_current` actually runs relative to how long QA sits idle.
Sent as a `note` (priority `00`) to the specifier.

### 3b — a nil landed-task-ticket-id and the BL-1773 in_process guard (probed, no gap)

`only-landed-tickets-own-pending?` (land_step_lib.bb, read at the mint's
own commit) returns `false` unconditionally when
`landed-task-ticket-id` is `nil` — its own docstring states this
explicitly ("With no landed-task-ticket-id in view ... always false;
every pending file still blocks, unchanged from before this ticket").
So a pending record armed with a nil ticket id does NOT retry under a
*weaker* guard than the land that armed it — it retries under a
*stricter* one (any in_process content at all blocks it, never narrowed
to "the landed ticket's own"). **No gap found**: the failure direction
probe 3b worried about (a weaker guard letting something through it
shouldn't) does not occur; the opposite (an over-strict guard that never
narrows) is the actual behavior, which is fail-safe, not fail-open. No
follow-up note.

### 3c — standing untracked paths still dirty the worktree (CONFIRMED)

`.gitignore` after the hotfix ignores `__pycache__/` and `*.py[cod]`
only; it does not mention `.qwen/`, evidence drafts, or `local_agent`
outputs. **Confirmed live, in this exact worktree, at review time**:
`git status --short` shows three untracked, non-`__pycache__` files that
predate this parcel and are not artifacts of it —
`extension/bl1666-invariant1-10k-search.js`,
`swarmforge/scripts/bl1652-non-vacuity-scratch2-11946-1790318102522.bb`,
`swarmforge/scripts/test/bl1652-non-vacuity-runner-11946-1790318102522.bb`
— each of which would independently make `post-land-repoint!` skip with
reason "an uncommitted change" exactly as `__pycache__/` used to, on any
checkout that happens to carry one. The gitignore fix narrows the KNOWN
cause it was built for; it does not close the general class (any stray
scratch/probe output a role's own tooling leaves behind, untracked, in
its worktree). Sent as a `note` (priority `00`) to the specifier.

## Goal 4 — record, do not review: is the cost bound holding?

`git rev-list --left-right --count origin/main...swarmforge-QA` (run
from this worktree, which shares refs with `swarmforge-QA` via the
common git dir): **`4  4135`** — `swarmforge-QA` is 4135 commits ahead of
`origin/main` (and 4 behind, i.e. genuinely diverged, not just linearly
ahead) at review time, 2026-09-29. This is not close to `origin/main`;
if anything it is larger than the ~4020 commits the hotfix's own commit
message cites as the incident it fixed. Recorded as instructed
("record, do not review") — no fix attempted here, and this parcel does
not speculate on why (a not-yet-landed re-point, a chain of skips this
hotfix only partially closes per probes 3a/3c above, or something else
entirely is for whoever reads this evidence to investigate separately).

## Invariant check

`git diff main...HEAD --name-only` for this parcel touches only: this
evidence file, the feature file (landed via an earlier `main` merge), its
step handler `bl1803SwarmStampDeferredLandRepointOnCleanTreeSteps.js`; no
edits to `land_step_lib.bb`, `land_step_cli.bb`,
`done_with_current_task.bb` or `.gitignore` (all read only, confirmed by
this same diff).
