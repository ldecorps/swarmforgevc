# Babysitter Article 4.2 on `9e1cc4da63d3` — same adjudicated class, QA completing the land the coordinator flagged

Date: 2026-09-04 (coordinator). `9e1cc4da63d3` "Complete the shared-registry
scaffolding land: the two sibling lib scripts the prior commit's handlers
execute" (parent `a69bcc5bb1c9`, trailer `By QA.`) is **FALSE POSITIVE**,
same root cause as
`babysitter-article42-qa-handland-on-main-false-positive-20260904.md`:
`is_qa_ancestor.sh` is ancestry-of-`swarmforge-QA`-only and doesn't read
authorship/trailer, so any hand-land in the master checkout flags regardless
of legitimacy. `is_qa_ancestor.sh 9e1cc4da63d3` -> rc=1, confirming the same
mechanism, not a new one.

This is QA acting directly on the coordinator's priority-00 note (see
`babysitter-article42-qa-untied-scaffolding-land-20260904.md`) that named
these exact two missing paths and their byte-identical worktree source.
Verified: `md5sum` of both landed files matches `.worktrees/QA` exactly;
`check_feature_handler_registration.sh` is now clean against the tree; diff
is five pure additions (the two named scripts plus three `ceremony_handoff.*`
files QA's own commit message explains are `bl1360CeremonyHandoffCli.sh`'s
dependency chain, already-approved BL-1360 deliverables, inert until
something on main invokes them). Nothing edited, nothing else changed.

`main` now accepts commits again (registration guard clear).

No revert, no ticket minted (nearest existing coverage already named in the
prior evidence file), no further note to QA. This class of false positive
will keep recurring for any master-checkout hand-land while `swarmforge-QA`
lags `main` — scoping the gate fix is the specifier's call, already
surfaced.

By coordinator.
