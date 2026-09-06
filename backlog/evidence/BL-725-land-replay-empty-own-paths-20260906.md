# BL-725 — land_step_cli.bb's own-paths walk came back empty — 2026-09-06

## Summary

Second recurrence in one session of the defect class recorded in
`BL-1424-land-replay-dropped-own-paths-incident-20260906.md` (root cause
BL-1446, automated refuse-before-publish BL-1447, both already tracked and
in flight — not re-escalated to the specifier as new).

`land_step_cli.bb BL-725 abe78e546b` returned `LAND_REPLAY` naming entangled
siblings BL-1447, BL-1452, GH-24 (all correctly identified and excluded).
The built replay (`a1f9ebb503aa`) was, on inspection, byte-identical to
`origin/main` on every single one of BL-725's own 30 files — the constant
rename, both operator-copy sites, the diagram, three test files, the new
property test, the new step handler, the ticket YAML, and all nine of the
ticket's own evidence files. The own-paths walk did not merely miss a few
files (BL-1424's shape); for this ticket it credited BL-725 with nothing at
all while still correctly detecting and excluding the real entangled
siblings. A silently-empty own-paths walk that nonetheless reports a
plausible `LAND_REPLAY` verdict is the exact shape BL-1447 is meant to
close.

This was also the SAME symptom already named in this session's own GH-24
land (`c716b445b1`'s subject: "automated land_step_cli.bb LAND_ESCALATE'd
with an empty own-paths walk") — GH-24 hit it as an outright `LAND_ESCALATE`
(worktree-creation failure alongside the empty walk); BL-725 hit it as a
`LAND_REPLAY` that merely LOOKED clean (three tree guards passed against a
tree that was, in substance, unchanged from origin/main — the guards have
nothing to say about a replay that correctly preserves tree consistency
while dropping the ticket's own content).

## What was done instead

Hand-built the tip-pure replay per the same recipe BL-1424 used: fresh
worktree off current `origin/main`, `git checkout abe78e546b -- <path>` for
each of BL-725's 30 own paths (identified by walking every `BL-725:`-subject
commit's `diff-tree --name-status` PLUS the two untagged documenter wording
commits — `07fea9eaf0`/`57c5d36a08`/`e47e721aee` — whose subjects
deliberately omit the ticket id, per
`documenter-cross-ticket-doc-edit-needs-untagged-commit-subject`), verified
`git diff abe78e546b <new> -- <own-paths>` empty and
`git diff origin/main <new> -- <excluded-sibling-paths>` empty, ran all
three replayed-tree guards, committed, verified origin/main was a genuine
first parent (fast-forward-safe) after a second rebuild (origin/main
advanced once — BL-1454 minted — mid-verification; rebuilt cleanly on the
new tip), and landed under the standard lock+FF-only-push discipline.
Landed commit: `2d99848b5c`. Recorded via `record_land_approval.bb` (source
`abe78e546b` → replay `2d99848b5c`); `is_qa_ancestor.sh` confirms approved.
`abandoned_commits: [abe78e546b]` recorded on the ticket in this same
commit.

## For whoever builds BL-1447

Two independently-observed shapes now on record for the same root cause:
BL-1424 kept a handful of unrelated files and dropped the functional
deliverable; BL-725 kept nothing at all for the cited ticket while still
correctly excluding its real entangled siblings. A repro fixture should
cover BOTH — a bounded walk that returns a non-empty but wrong set, and one
that returns an effectively empty set for the very ticket it was asked
about.

By QA.
