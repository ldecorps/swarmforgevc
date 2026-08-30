# BL-1300 spec-gap: approval asks that pose a choice with no `ruling_options`

*Specifier, 2026-08-30. Written because the coder's spec-gap note on BL-1300
turned out to be an instance of a class, and the other instances should not have
to be re-derived.*

## What the coder found

BL-1300's `approval_context` posed a binary choice (option 1 / option 2) and the
ticket declared no `ruling_options`. Per BL-589 a ticket without that field keeps
the plain five-button keyboard **byte-identically**, so the human's 19:37 BST
Approve tap (`ce7db10c62`) recorded `human_approval: approved` and no
`human_ruling`. The ticket then read as fully approved while the one thing the
coder needed was unknown. The coder refused to guess and sent a spec-gap note
(22:13Z) — correct, and it cost a full round trip. Fixed in `fa44ad1619`.

## The survey, and why the first number was wrong

A keyword sweep over `active/`, `paused/` and `hold/` (cues: "your call",
"option 1/2", "which of", "choose", "either is", "two things need") flagged
**9** tickets carrying an `approval_context` with no `ruling_options`. That count
was committed in `a8ed0970ca` before the hits were read, and it was wrong.
Reading all nine:

| Ticket | Lane | `human_approval` | Verdict |
|---|---|---|---|
| BL-824 | paused | approved | **genuine** — remote-UI technology choice, specifier proposed WebView and asked for sign-off |
| BL-1225 | hold | approved | **genuine** — whether to keep the intake's "Optional" third bullet |
| BL-1252 | hold | approved | **genuine** — cheap-tier guard vs complete four-guard inventory |
| BL-1286 | paused | approved | **genuine** — commit-or-delete `wait_pipeline_drain.sh`, and whether to build the gate at all |
| BL-1294 | paused | pending | **genuine** — jump ahead of BL-1240, or let the coder unblock another way |
| BL-987 | paused | approved | false positive — says the branch "is the ticket's work", explicitly not asking |
| BL-1292 | paused | approved | false positive — caveats about what the ticket claims |
| BL-1305 | paused | approved | false positive — says the scope question "needs no ruling" |
| GH-29 | paused | approved | false positive — a re-flag notice; Approve is the right answer |

**5 genuine of 9 cues (~56% precision), 4 of them already `approved`** — i.e. in
four tickets the human answered and the answer went nowhere.

## Decision: no mechanical gate

A cue-matching check in `specifier_backlog_hygiene_gate.sh` was considered and
**rejected**. At ~56% precision it would refuse legitimate tickets on prose that
merely mentions a choice while declining to ask for one, and a gate people learn
to override is worse than no gate (the same failure shape BL-1300 itself
describes: a check whose message names something the reader cannot act on). The
fix landed instead as a mint-time rule in `swarmforge/roles/specifier.prompt`
(`a8ed0970ca`, corrected `ae61df0f39`), where the judgment is actually possible.

## Disposition of the five

- **BL-1300** — fixed, `ruling_options` declared, re-pended to collect the
  ruling (`fa44ad1619`). The re-pend is deliberate and recorded in its `notes:`;
  it is not an erased approval.
- **BL-1294** — fixed pre-emptively (`bd8a7ae735`). Still `pending`, so adding
  `ruling_options` erased no tap. It is severity `high` and blocking BL-1240,
  which is why it was worth doing now rather than at promotion.
- **BL-824, BL-1225, BL-1252, BL-1286** — deliberately **not** touched. Each is
  already `approved`, so adding `ruling_options` means re-pending, which erases a
  real human tap and re-asks for it. None is in flight (paused/hold), so nothing
  is blocked today. Fix each at **promotion**, where the Article 3.6 freshness
  gate already routes it past the specifier and the re-ask costs one tap on a
  ticket that is about to be built anyway. Whether to re-ask all four in a batch
  instead is a human call, not the specifier's.

## Note for whoever fixes one of the four

Re-pending is the only way to make the ask re-fire, and `pendingApprovalFor`
scans active AND paused (BL-408/BL-480), so it works from either lane. Record in
the ticket's `notes:` that the `pending` is a deliberate re-ask and name the
original approval commit — otherwise it is indistinguishable on sight from an
erased approval, which is a live hazard in this repo.
