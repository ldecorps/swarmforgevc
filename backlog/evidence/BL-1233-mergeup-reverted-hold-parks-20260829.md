# BL-1233 merge-up: guard caught a real revert-of-park

`git merge ff6529c57b` (QA's BL-1233 merge-up broadcast) resolved six
paths as "theirs unchanged at backlog/active/, ours moved to
backlog/hold/" -> merge picked theirs, silently reverting the park:

- BL-1233-launcher-guard-survives-ambient-git-env.yaml
- BL-1234-property-allowlist-gate-recognises-every-red.yaml
- BL-1242-merge-never-silently-drops-branch-work.yaml
- BL-1244-a-delivered-answer-frees-the-question-slot.yaml
- BL-1247-bl593-property-generator-emits-values-its-own-contract-refuses.yaml
- BL-1249-expeditor-restart-honours-the-operator-pause-marker.yaml

Verified via merge-base c14bec9cfc: base has each at active/, HEAD
(documenter) has each at hold/ only, ff6529c57b (QA) is unchanged from
base (still active/ only) for every one of the six. Content of each
hold/ copy is byte-identical to the active/ copy the merge tried to
introduce - only the location differs, confirming this is the park
being clobbered, not a content conflict.

check_merge_deletion.sh (BL-1242) refused the commit for 5 of 6
(unattributed introducing commit: `fbc984f19 "Merge main into
documenter worktree"`, no ticket id in subject). BL-1244 was
attributed to BL-1233 by coincidence (its introducing commit's subject
happened to name BL-1233) and would have passed silently on message-
naming alone - the guard's design intent (per its how-to,
docs/how-to/BL-1242-merge-deletion-guard.md) is "re-merge / restore the
branch's own change", not "name it and let it through" for this
not-QA's-deletion shape, so BL-1244 was fixed identically rather than
let through on the coincidence.

Fix applied: re-staged all six back to backlog/hold/ only (matching
HEAD, since QA's branch never touched these paths), removing the
spurious backlog/active/ copies before committing the merge.

By documenter.
