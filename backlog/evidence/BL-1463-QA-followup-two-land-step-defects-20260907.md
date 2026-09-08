# Two new land-step defects found landing BL-1463, 2026-09-07

Found while attempting to land BL-1463 (already approved, evidence
`backlog/evidence/BL-1463-QA-20260907.md`). Not a defect in BL-1463 itself —
BL-1463's own content is correct; the land step cannot currently publish it
for two independent, structural reasons below. Parcel held un-landed pending
adjudication.

## Context: this session's BL-1348 restoration

Earlier today I bounced BL-1348 (spec-gap) and, per BL-490/495, reverted the
merge that carried it (`108d9a46e7`). The specifier adjudicated
(`backlog/evidence/BL-1348-wholesale-bounce-revert-adjudication-specifier-20260907.md`)
that the revert was over-broad — an omission bounce should revert nothing —
and instructed QA to restore the reverted paths. I did:
`git revert 108d9a46e7` → `adfc35e0c8` ("Reapply \"Merge documenter
9dd64ab8ba into QA.\""), resolving one Specification.MD changelog-stack
conflict. This correctly restored `resolveFreeCoresCeiling`, its tests, both
vitest configs, and BL-940's/BL-1468's evidence — confirmed by `npm run
compile` clean and the function present. BL-1348's own bounce disposition is
untouched (feature file still lacks scenario 03; bounce evidence intact).
Landing BL-1463 next surfaced two land-step defects this restoration
exposed.

## D1: an untagged revert/reapply commit loses path attribution, so its
content silently defaults to whichever ticket lands next

`land_step_lib.bb`'s per-path attribution (`path-owner-tickets` /
`path-attributing-commits`, feeding `own-paths`) credits a path to a ticket
by reading commit subjects for a ticket id. `own-paths`' own invariant 2
(never exclude a path attributed to nobody) means: when NO commit touching a
path in `origin-main..commit` carries a ticket tag, that path defaults to
the ticket currently being landed - not to "unattributed, exclude it."

My restoration commit `adfc35e0c8` ("Reapply \"Merge documenter
9dd64ab8ba into QA.\"") carries no ticket tag. It is the LATEST commit
touching `extension/src/tools/vitest-worker-memory-budget.ts`, both
`bl1348.../bl871...property.test.js` files, `extension/vitest.config.mjs`,
`extension/vitest.properties.config.mjs`, and
`extension/vitest.bl1348.stryker.config.mjs` in BL-1463's own
`origin-main..commit` range. Verified directly:

```
$ bb -e own-paths for BL-1463 at adfc35e0c8 → 40 paths, including:
extension/src/tools/vitest-worker-memory-budget.ts
extension/test/bl1348VitestWorkerPoolHostSizingInvariants.property.test.js
extension/test/bl871PropertyLaneWorkerPoolCapInvariants.property.test.js
extension/vitest.config.mjs
extension/vitest.properties.config.mjs
extension/vitest.bl1348.stryker.config.mjs
```

None of these are BL-1463's own work - they are BL-1348's ruling-B
production code and tests, genuinely unapproved-as-BL-1463 (BL-1348 is
still bounced, mid-rework at the coder). Before my restoration, the SAME
`own-paths` call (against the pre-restoration tip `30eeba39fd`, still
carrying the correctly-tagged original commits under the revert) correctly
attributed and excluded only BL-1348's own two files
(`backlog/active/BL-1348-...yaml`, `backlog/evidence/BL-1348-bounce-...md`)
as `EXCLUDED_SIBLING_PATH ... BL-1348` - the revert had not yet broken
anything because the ORIGINAL tagged commits were still the last thing to
touch those paths in a git-log sense at that point... but once I reverted
the revert, the newest touch became my own untagged commit, and the
attribution flipped from "excluded, BL-1348's" to "credited to whoever
lands next" with no error, no warning, silently.

This is the land-time counterpart of a known, related, distinct bug:
`BL-1295-revert-subject-does-not-blame-the-reverted-ticket.yaml` (status
`blocked`) is about the SEND-TIME scope gate crediting a revert to the
WRONG ticket (the reverted one, inherited via `Revert "<original
subject>"`). Mine is the opposite shape at a different consumer: a revert
(or reapply) with NO tag at all, at LAND time, silently defaults to the
CORRECT-seeming but wrong ticket (whichever is landing). Same root class -
a commit whose subject carries no reliable ticket attribution - two
different silent failure directions.

**Why this matters**: any bounce-revert-then-reapply cycle on a shared QA
branch permanently strips ticket attribution from the touched paths for
every land after it, until either that content actually lands (attribution
becomes moot) or a differently-tagged commit touches the same paths again.
A BL-1463 land right now would have republished BL-1348's unapproved
production code and tests as BL-1463's own, with land_step_cli.bb reporting
nothing wrong.

## D2: `replay!` reports EVERY non-zero `git commit` exit as "nothing to
commit / own-paths identical to origin/main," masking the real reason -
here, a correct merge-deletion-guard refusal

Independently of D1, `land_step_cli.bb BL-1463 adfc35e0c8` (and every retry
against the moving origin/main) escalated with:

```
land-step replay: nothing to commit for BL-1463 - own-paths identical to origin/main
```

This message is FALSE. Reproduced by hand: built the replay's scratch
worktree off the same origin-main sha, applied the exact same 40 own-paths
via `git checkout <cited> -- <path>` / `git rm`, and got real, substantial
`git status` output (39 files touched, additions, deletions, modifications)
- not an empty diff. Running the actual `git commit` by hand surfaced the
REAL error, which `land_step_lib.bb`'s `replay!` (line ~1373-1378) never
reads - it treats ANY non-zero `git commit` exit as proof of an empty
diff:

```
Error: commit deletes 'backlog/paused/BL-1470-...yaml' (BL-1470), which
appears at no other staged path and is not named in the commit message.
Error: commit deletes 'backlog/paused/BL-1471-...yaml' (BL-1471), which
appears at no other staged path and is not named in the commit message.
Commit rejected: name the ticket id in the commit message to confirm a
deliberate retirement (e.g. "Retire BL-1471: ...").
```

The merge-deletion guard is firing CORRECTLY on its own terms - BL-1470 and
BL-1471 are two tickets the specifier minted directly on origin/main in the
last few minutes (adjudicating my earlier BL-1466/BL-1348-revert notes),
and BL-1463's branch predates both. `own-paths`' diff (`origin-main..commit`)
sees them as present-on-one-side-absent-on-the-other and, finding no
positive attribution otherwise, includes them in the replay as deletions -
which is itself questionable (a path neither commit in BL-1463's own range
ever touched should arguably never be proposed as BL-1463's deletion at
all, the same "absence is not evidence" posture `own-paths`' own docstring
already applies to *inclusion*), but the guard is a legitimate, working
safety net against exactly this. The bug is that `replay!`'s error handling
cannot distinguish "index genuinely unchanged" from "a commit-time guard
refused a real, non-empty commit," and reports the former unconditionally,
which sent me chasing a phantom "why is own-paths empty" investigation for
some time before hand-reproducing the actual commit and reading its real
stderr.

**Why this matters**: every LAND_ESCALATE from this branch of `replay!`
currently reads as "nothing changed," hiding whatever the actual guard
objection was. An operator or specifier adjudicating a `LAND_ESCALATE` note
from this message alone has no way to know a real, fixable guard trip (here,
a fast-moving origin/main outrunning the parcel's own branch) is the cause
without independently reproducing it by hand, as I just did.

## Not a defect in BL-1463

BL-1463's own 6 acceptance paths and content are unaffected and correct
(unchanged from the approved `backlog/evidence/BL-1463-QA-20260907.md`
pass). Both defects are pre-existing land-step machinery gaps that this
land attempt happened to trip.

## Recommendation (direction, not mandate)

- D1: `own-paths`/`path-owner-tickets` should not default an untagged
  commit's paths to the landing ticket when a path's fuller history (not
  just the latest touching commit in range) shows a different ticket's
  tag - or, cheaper, a revert/reapply commit's message should preserve the
  original tag the same way BL-1295's fix (once unblocked) would need to
  reason about subjects, so land-time and send-time attribution use one
  consistent rule instead of two.
- D2: `replay!` should surface the actual `git commit` stderr/reason in its
  `:reason` string instead of assuming emptiness - at minimum, distinguish
  "nothing staged" (`git diff --cached --quiet` before attempting commit)
  from "commit refused for another reason" (any hook/guard stderr).

Not fixed here - QA does not write production code. Sent to the specifier
as an urgent note; BL-1463 stays un-landed, in_process, pending
adjudication.

By QA.
