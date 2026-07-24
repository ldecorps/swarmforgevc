# Incident — BL-607 mid-pipeline commit landed directly on `main`, bypassing QA

**Not a bounce.** BL-607's own parcel (documenter commit `7fa17fecd1`, merged
into this QA review as `4b5505067`) is correct and PASSES — see the BL-607 QA
PASS note. This is a separate, process-level finding surfaced during QA's
pre-approval ancestry check and is being filed for operator/coordinator
awareness, not routed back to the coder.

## What was found

Commit `6da4c2602c11` on `main` (author `swarm-intake[bot]`, 2026-07-24
05:52:46 +0100, message verbatim `Merge commit '16e7c461dd'` — git's own
default merge message, no role byline, no "QA-approved" framing) merges
`swarmforge-coder`'s BL-607 chain — up through the SECOND architect bounce fix
(`10f7834a7`) and a same-day stale-comment fix (`16e7c461dd`) — directly onto
`main`, parent `d370c3cfb`. Diff vs. that parent: 13 files, 2092 insertions,
including the full production surface (`telegramFrontDeskBotCore.ts`,
`telegramTopicDecisions.ts` (new), `swarmforge/scripts/role_ask.bb` (new),
`swarmforge/roles/specifier.prompt`, plus tests and the step-handler file).

This is NOT the "comment-only, non-functional" divergence the hardener's
evidence (`BL-607-hardener-pass-20260724.md`) described and treated as
routine merge noise — the hardener's characterization undersells it. What
actually landed bypassed the architect's 3rd pass (`07d7ff3c3`, the
`composeRoleAnswerNoteMessage` property-test hardening), the hardener's own
CRAP/DRY pass (`119e8c182`, the `captureRoleAnswer`/`deliverAskMessage`
extractions), and the documenter — and did so without ever routing through
`swarm_handoff.sh` or a QA gate. Per the constitution, `main` integration is
QA's exclusive province (BL-247); this commit's authorship/timing points at a
direct `git merge` run from the shared `main`/master checkout (only
specifier/coordinator work there) rather than the normal pipeline chain.

## Why this parcel is unaffected

`16e7c461dd` (the tip of the leaked chain) is a genuine ancestor of BL-607's
full, QA-reviewed lineage in this worktree — the leak and this parcel share
real history, they didn't fork. Landing this parcel's approved commit onto
`main` via an ordinary (non-fast-forward) merge supersedes the leaked partial
state with the complete, hardened, documented one; no functional content is
lost or duplicated. Confirmed no other commit touched any of the affected
files on `main` between `6da4c2602` and the tip QA landed from.

## Why it matters anyway

For roughly two hours, `main` carried BL-607 production code that had not
passed architect's final review, was not mutation/CRAP/DRY-hardened (the
duplicated capture-answer logic hardener later extracted), and was
undocumented — with no trace of that state ever going through
`swarm_handoff.sh`. If anything had deployed from `main` in that window, or
if a concurrent ticket had touched the same files, this would have been a
real integrity break, not a merge-noise curiosity. The generic, byline-less
commit message suggests this was accidental (a raw `git merge` typed against
the wrong ref) rather than a deliberate emergency landing.

## Second, worse instance — already pushed to `origin/main`

`git fetch origin main` at QA landing time shows `origin/main` sitting at
commit `ae5d3cf62646` (author `swarm-intake[bot]`, 2026-07-24 07:56:05 +0100,
message `Document BL-607: pipeline roles can raise clarifying questions into
their own Telegram topics` — the documenter's own commit MESSAGE, but NOT the
documenter's own commit: its parent is `0a67d83ce` (an ordinary `main` commit,
"Intakes: burn-rate briefing warning...", itself a descendant of the first
leak `6da4c2602`), not the documenter branch's real ancestor chain. This is a
second direct write straight onto `main` — 574-line diff to
`docs/reference/Specification.MD`, textually identical to documenter's real
commit `7fa17fecd1` — that landed 46 seconds AFTER `7fa17fecd1` was made on
the documenter branch (07:56:51) but was committed independently onto `main`
at 07:56:05 (i.e., cannot be a fast-forward/merge of it; it is a second,
separate write of the same content). Confirmed neither the architect's 3rd
pass (`07d7ff3c3`) nor the hardener's CRAP/DRY dedup (`119e8c182`) is an
ancestor of `ae5d3cf62` — so the version already **pushed to origin and
publicly visible on GitHub** is the pre-hardening state (duplicated
capture-answer logic, CRAP-8 functions) plus a copy of the final docs, never
gated by QA, never pushed by QA. This is no longer a local-repo curiosity —
it is live on the remote. QA's landing step (below) merges over this with the
fully-reviewed, hardened, documented commit and re-pushes to correct
`origin/main`; the fix is mechanical, but the fact this reached `origin`
un-gated is the escalation-worthy part.

## Recommendation

Root-cause who/what ran the raw merge/commit on `main` at 05:52 and 07:56
(likely specifier or coordinator activity in the shared master checkout —
both lack a dedicated worktree) and, given one instance already reached
`origin`, close the gap that let either happen without `swarm_handoff.sh` and
without QA's push. Suggest a coordinator/operator follow-up ticket treated as
urgent given the origin push; not something QA can fix by editing code.

— By QA.
