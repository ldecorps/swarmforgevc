# BL-1459: PRE_QA_GATE_FAIL ancestry — f46bd22ab1 stranded on coder/cleaner

Recorded by: documenter, 2026-09-20, forwarding the hardener-reviewed
BL-1459 lineage (documenter commit 35933c0174) to QA.

## What the gate said

```
PRE_QA_GATE_FAIL ancestry BL-1459 f46bd22ab1 stranded on swarmforge-cleaner
PRE_QA_GATE_FAIL ancestry BL-1459 f46bd22ab1 stranded on swarmforge-coder
```

## What f46bd22ab1 is

`f46bd22ab1` ("BL-1459: hotfix - hook mode judges only the documenter
branch's exact current tip, not any ancestor of it", by coder,
2026-09-20 02:52:55+01:00) is a follow-up fix to
`check_documenter_briefing_tip.sh`'s hook mode, committed AFTER the
lineage I received from hardener (`05169cb899`, 02:56:51+01:00 — later
clock time, but built on an EARLIER coder tip that predates this hotfix).
It has not been through cleaner/architect/hardener review as part of the
lineage I hold; `swarmforge-cleaner`'s own tip shows it merged in
(`c9edb97b1f`) and cleaner has since kept working (`72c49f2716`), so this
looks like the next iteration of BL-1459 work still in flight upstream of
me, not something reachable through the parcel I was actually handed.

## Related finding (not this evidence's own claim, but relevant context)

The coder's own commit `f1f3c8639a` (same session) records a separate,
deeper "documenter branch entanglement" finding — that
`swarmforge-documenter`'s first-parent history at some point apparently
absorbed an unrelated, unlanded cleaner commit directly (not via a normal
merge). I have NOT independently reproduced that claim against my own
current tip (`35933c0174`) and make no finding of my own here; flagging
it only because it's adjacent context the specifier may want alongside
this gate failure. My own branch's `git status` is clean and its history
back through `aaff33053a` (merge of hardender's `05169cb899`) looks
ordinary to me.

## Why this isn't documenter's fix

`check_documenter_briefing_tip.sh` is production pipeline machinery
(coder-owned); the hotfix is real work still moving through review
upstream, not a defect in my documentation pass. I have no fix to make
and no judgment call to make about whether to pull in unreviewed
upstream work.

## Documenter's own state

`swarmforge-documenter` HEAD is `35933c0174` — untouched by this. Parcel
held `in_process`, not forwarded, pending the specifier's or coder's own
resolution (the hotfix reaching me through the normal pipeline, or an
`abandoned_commits:` ruling).
