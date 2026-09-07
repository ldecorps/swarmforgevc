# Unowned red found committing BL-1452: bl1375ApprovedSiblingsCanLandInvariants property test

Discovered when the property-suite-guard ran on BL-1452's commit (staged
`extension/src/*` changes trigger a full `test:properties` run per
`check_property_suite_drift.sh`'s `path_triggers_check`). Not a flake -
`property-suite-guard` re-ran it alone and it "still fails when run alone",
so the guard refused the commit outright (`Commit rejected: property suite
failed with non-allowlisted files:
test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js`).

**Confirmed on `main`, not my worktree's own state**: `git diff main --
extension/test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js
swarmforge/scripts/land_step_lib.bb` is empty - my coder worktree carries
no unmerged change to either file.

**Grepped first**: not in `backlog/standing-reds.tsv`; no active/paused/hold
ticket names `bl1375ApprovedSiblingsCanLandInvariants`. Unowned.

## The failure

`BL-1375/BL-654 invariant 2: a passenger rides only through a
self-consistent replayed tree`, first fast-check case (0 shrinks):

```
Counterexample: ["landing/anchor.txt"]
Caused by: AssertionError: the plan refused before the guard could speak:
{"action":"escalate","reason":"land-step replay: refusing to publish
BL-9375 - the replayed tree is not self-consistent with passenger
sibling(s) BL-9376 riding on a shared path (BL-1375 invariant 2 /
BL-1324): check_feature_handler_registration.sh refused the replayed
tree ...  missing or unreadable registry module:
specs/pipeline/steps/bl9376FixtureSteps.js ...","unlanded":["BL-9376"]}
Expected: "replay"
Received: "escalate"
```

## Likely cause (not fixed here - not this ticket's scope)

This looks like a regression from BL-1447 (this session, already landed),
not something BL-1452 touches. BL-1447 changed `land-plan`'s `:replay`
branch to call `replay!` itself and run the tree-consistency/completeness
guard (`check_feature_handler_registration.sh` among others) *before*
returning `:replay`, escalating instead on any failure. BL-1375's own
**acceptance** handler (`bl1375ApprovedSiblingsCanLandSteps.js`) was
updated for this during BL-1447 (a `landHandlerOnMain` helper defaults an
untested scenario's tree to consistent) - see
`backlog/evidence/BL-1447-*.md`. This **property** test
(`bl1375ApprovedSiblingsCanLandInvariants.property.test.js`), which
exercises the same `land-plan`/`replay!` pair independently for the BL-654
declared invariant, was not updated for the same behavior change: its
fixture builds a deliberately-inconsistent replayed tree to test something
else about invariant 2, and now trips the new internal consistency guard
first, so `land-plan` returns `:escalate` where the test still expects
`:replay`.

## Impact

`path_triggers_check` matches any `extension/src/*` staged path, so this
red currently refuses **every** commit (any role, any ticket) that touches
`extension/src/` - broader than a single QA-approval veto (Article 4.2);
it is a pipeline-wide throughput blocker until fixed or allowlisted
(`swarmforge/scripts/property_suite_standing_allowlist.tsv`, BL-1175 -
currently empty, header only).

## Not fixed here

Out of BL-1452's scope (a different ticket's declared-invariant property
test, unrelated to bounce recorders/ticket ids). Sent as a note to the
specifier and coordinator (priority 00) rather than fixed as part of this
parcel.
