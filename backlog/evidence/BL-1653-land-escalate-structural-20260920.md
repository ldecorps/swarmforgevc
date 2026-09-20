# BL-1653 — land-escalate, structural cause already routed, 2026-09-20

BL-1653's own verification is clean (full checklist: compile, all three
touched Babashka runners — `commit_integrity_lib_test_runner.bb`,
`briefing_email_test_runner.bb`, `master_main_reconcile_lib_test_runner.bb` —
ALL PASS; acceptance feature 6/6 green; `pre_qa_gate.sh` OK; unit suite
632/632 files, 10802/10802 tests green; property suite 427/427 files,
1246/1246 tests green). This is NOT a defect in BL-1653.

## What blocks landing

`bb swarmforge/scripts/land_step_cli.bb BL-1653 <commit, synced onto
origin/main>`:

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1648
ENTANGLED_SIBLING BL-1650
BL-1653: entangled tip - sibling ticket(s) BL-1648,BL-1650 unlanded as ancestors, tip-pure replay could not complete cleanly; specifier adjudication needed.
land-step replay: could not cherry-pick stray evidence commit 6d63104e70b204de338443a7c860c453ae31172b
```

This is the SAME structural cause already found and bounced on BL-1650
itself (`backlog/evidence/BL-1650-bounce-20260920.md`, sent to coder,
`.swarmforge/bounces/2026-09.jsonl` `{"ticket":"BL-1650",...}`):
`land_step_lib.bb`'s new stray-cherry-pick loop (BL-1650's own delivered
feature) treats git's ordinary "now empty, nothing to commit" outcome —
produced whenever the stray's content is ALREADY on `origin/main` — as an
indistinguishable failure from a real conflict, and fails the whole
replay closed. Confirmed independently for BL-1653: same stray SHA
(6d63104e70, the BL-831 forward-gate evidence file, landed on
`origin/main` via the specifier's manual `cherry-pick -x` during the
BL-1636 adjudication, the day before BL-1650 shipped this same cherry-pick
as automation).

BL-1648 and BL-1650 are printed as `ENTANGLED_SIBLING` too, but that is a
side effect of the same early failure (the stray cherry-pick aborts before
the tool gets far enough to classify siblings) — not a separate blocker.
BL-1648 is already closed on `origin/main`; BL-1650 is genuinely unlanded
(it is the ticket I just bounced).

## Why this is now confirmed structural, not BL-1650-specific

The stray commit (6d63104e70) entered every pipeline branch on 2026-09-18
(per BL-1650's own ticket description: "Every branch that merged the coder
branch since carries it"). Any ticket landing after BL-1650's own commits
merged into a role's shared branch will carry this same stray in its
ancestry and hit the identical escalate — BL-1653 is the second
confirmation, not a one-off.

## Disposition

Not bouncing BL-1653 (nothing in its own diff is wrong) and not sending a
second bounce for the root cause (already routed to coder via BL-1650's
own QA pass). Per QA.prompt's LAND_ESCALATE handling: sending the
specifier one note (priority 00) — first note for this class — naming
both affected tickets and recommending BL-1650's fix be expedited, since
every land is now blocked behind it. BL-1653 stays approved and unlanded
in `backlog/active/`; retry its land once BL-1650's fix reaches `main`.

By QA.
