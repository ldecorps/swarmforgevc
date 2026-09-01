# Specifier ruling — BL-1303 QA hold upheld; root cause re-diagnosed; BL-1315 amended to cover it
2026-08-31

QA note, priority `00`: "BL-1303 QA hold: land-step drops its own files,
mirrors BL-1298 (`e5429fb4da`)". Evidence:
`backlog/evidence/BL-1303-qa-hold-land-step-cross-contamination-20260831.md`.

## Ruling

**The hold is correct. Upheld. No rework is owed to BL-1303's chain and no
bounce is warranted.** QA's *observation* is verified exactly. QA's *root-cause
guess* is wrong in a way that would have sent someone chasing dangling
branches, and is corrected below. The defect is BL-1315's — the same
computation, the opposite direction — and BL-1315 has been amended to cover
it rather than a second ticket minted.

## QA's observation, verified independently

Checked from the master checkout on `main`, not taken on trust:

    git cat-file -e ab8d10a8b3:extension/src/tools/check-feature-handler-registration.ts   -> PRESENT on the QA tip
    git cat-file -e b4151e2098:extension/src/tools/check-feature-handler-registration.ts   -> ABSENT from the replay tip
    git cat-file -e origin/main:extension/src/tools/check-feature-handler-registration.ts  -> ABSENT from origin/main

Same three-way result for `featureHandlerRegistrationReport.ts` and
`specs/pipeline/steps/bl1303FeatureHandlerRegistrationSteps.js`. Meanwhile
`swarmforge/scripts/check_feature_handler_registration.sh` IS on the replay
tip. So the replay is a PARTIAL BL-1303: the guard shell script lands, the CLI
it shells out to does not. QA's read of the consequence is right — landing it
wires a guard whose `$CHECKER` has no source, failing closed on every
subsequent commit and merge to `main`.

Proven at the source rather than inferred, by running the real function:

    bb -e '(load-file "swarmforge/scripts/land_step_lib.bb")
           (land-step-lib/own-paths "." "ab8d10a8b3" "BL-1303")'
    -> 20 paths, none of them the 9 QA listed.

## Root cause — NOT what the hold note says

QA wrote that "a different ticket's still-unlanded, still-dangling replay
branch also touches the same paths", naming `land-replay/BL-1298-86c2ed1c2d`
(`adb6e0beff`). That is a **symptom, not a cause**. Dangling refs are outside
the range `own-paths` walks; deleting them would change nothing.

The actual mechanism, read off the refs:

1. `own-paths` picks candidates with
   `git rev-list --first-parent origin/main..ab8d10a8b3`. Exactly ONE names
   BL-1303: QA's receive-merge `ab8d10a8b3`.
2. `:delivered` for that merge is a two-tree diff against its **FIRST parent**,
   `467b65f0ff`.
3. BL-1303's files were **already on that first parent**. They arrived earlier,
   as second-parent passenger content on `86c2ed1c2d` (QA's merge of documenter
   BL-1298, whose branch had merged BL-1303's upstream work). Verified:

       git cat-file -e 467b65f0ff:extension/src/tools/check-feature-handler-registration.ts  -> PRESENT
       git cat-file -e 86c2ed1c2d:extension/src/tools/check-feature-handler-registration.ts  -> PRESENT

4. So the diff shows only the DELTA since — the last hops' 20 paths — and the
   replay, which materialises origin/main plus `own-paths`, drops the rest.
   They are unambiguously BL-1303's own: `git log` attributes them to
   `4073795d88` and `1ad04298d3`, both BL-1303 commits.

**`:delivered` answers "what did this merge bring in relative to its first
parent". The replay needs "what does this ticket's chain contribute relative
to origin/main". Those differ precisely when the ticket's own work reached the
branch before its own tagged merge did.**

## One defect, two faces — and that is why it is BL-1315, not a new ticket

The same event causes both holds. `86c2ed1c2d` put BL-1303's work on the QA
branch under BL-1298's subject:

- **BL-1298's replay OVER-includes** those files — they are in its tagged
  merge's first-parent diff, and they are not BL-1298's. (Held this morning.)
- **BL-1303's replay UNDER-includes** the same files — they are no longer in
  ITS tagged merge's first-parent diff, and they are BL-1303's. (Held now.)

BL-1315 already carries the property that forbids the second face, as its
**invariant 1**: "No path the landed ticket's own chain delivered is ever
dropped from the replay tip, whichever role authored it and whether or not
that role's commit names the ticket." What it lacked was a description and a
scenario that make the invariant executable — its `How (direction)` said only
"subtract the sibling's paths from the delivered path set", and an implementer
following that literally would ship all five scenarios green with BL-1303 still
unlandable, because subtraction cannot add back what was never in the set.

So this is a **description gap in an approved ticket**, not new scope. Amended
in place: the description now names the under-include half and its base-of-set
cause, scenario 06 exercises it, and the direction now says to base the set on
the full `origin/main..tip` range before subtracting. One function
(`land_step_lib.bb`'s `own-paths`), one root cause, one sitting — INVEST
"Small" still holds.

**The human ruling stands and was NOT reset.** `human_ruling` is "option 1 —
narrow the replay tip by attribution, so an entangled parcel can still land its
own work". The amendment adds no fork; it makes the clause "can still land its
own work" actually true, and enforces invariant 1, which
`approval_context` explicitly recommended ("option 1 with both invariants
enforced"). Re-pending here would erase a genuine approval to ask a question
already answered.

`priority:` 6 -> 4 (lower is higher). It now blocks two verified-green parcels
in a deadlock, which BL-1309 at 5 does not; it stays behind BL-1310 and BL-1318
at 3.

## The deadlock is real — neither ticket can go first

- BL-1298 cannot land as cited: its tip carries BL-1303's bounced guard
  (specifier ruling, this morning, upheld).
- BL-1303 cannot land as cited: its replay drops its own core files.
- There is no re-cite available. Only one commit on BL-1303's first-parent walk
  names it, so there is no earlier tagged merge whose first parent predates the
  passenger ride. Citing an upstream non-merge commit is the failure mode
  already recorded as strictly worse than the block (a silently partial parcel),
  and hand-stripping is what `QA.prompt` forbids.

BL-1298's earlier ruling said the pair self-resolves once BL-1303 lands. That
prediction is now falsified: BL-1303 cannot land either. **BL-1315 is the only
exit.** Both parcels unpark by re-running `land_step_cli.bb` on the same cited
commits once it ships — no re-work, no re-verification of the parcels
themselves.

## Route BL-1315 by expeditor, not the pipeline

BL-1315 is a defect in the land step. A parcel for it built normally reaches
`swarmforge-QA` — the branch already carrying this entanglement — and is held
by the very defect it repairs. Same shape as BL-1297/BL-1298, and the same
answer: `swarmforge/scripts/expedite.sh BL-1315 --no-restart`. Two known
hazards to carry in: the expedite path skips the `required_wiring` gate, so
verify BL-1315's two anchors by hand; and `--dry-run` is not dry once
`.worktrees/expedite-BL-1315` exists. Promotion and routing remain the
coordinator's call — this is a recommendation, not a route.

## Bookkeeping

`backlog/active/BL-1303-...yaml` `notes:` now carries the park, the unpark
condition and an explicit "no rework is owed" — state that lives only in an
evidence file invites a wrong demote later. The ticket stays in
`backlog/active/`: `backlog/hold/` silences the approval sweep, which scans
active and paused only.

Bookkeeping-only amendment on BL-1303. Nothing anyone builds changes, so it is
not a rebuild and needs no merge-and-re-read from its holder. BL-1315 is
paused and unstarted, so its amendment reaches no worktree.

By specifier.
