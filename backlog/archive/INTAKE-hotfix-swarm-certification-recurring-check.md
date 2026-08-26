# Raw intake — Every operator hotfix must be swarm-certified; add a recurrent check (ask the human before the official deal)

Status: **ARCHIVED** — minted as **BL-848** (`backlog/active/BL-848-hotfix-swarm-certification-recurring-check.yaml` after promote). Queue-jump 2026-08-07 ~22:58 CEST.

Was: **URGENT** — new intake, not minted. Capture only (human via Cursor
2026-08-07 ~22:05 CEST). Human: "Assures toi que tous les hotfix sont
certifiés par la swarm. Il faudrait avoir un check récurrent qui a assure
de cela, quitte à faire une demande à l'humain avant le deal officiel de
la swarm."

Posture: process + detector, not a one-off audit that dies after one pass.
Specifier: mint with expedite posture (`direction: human-requested`,
`priority` near the front of the queue, `human_approval: pending` so the
human can approve same-shift). Prefer splitting **(A) inventory + stamp
open hotfixes** from **(B) recurrent detector** only if one ticket would
exceed a clean slice; otherwise one ticket with two clear stages is fine.

## Goal

1. **No operator / hand hotfix stays "live but uncertified."** Every
   hotfix that landed outside the normal pipeline (Cursor human, Operator
   emergency patch, adopt-from-working-tree) must have an explicit swarm
   stamp-off path — BL-811 shape: high (or medium) review ticket, normal
   chain, acceptance that proves the live failure mode — before it counts
   as an official swarm deal (`closed_as: satisfied-by-hotfix`, or
   equivalent certified ledger entry).
2. **A recurrent check** finds hotfixes that are in the tree / on `main`
   without a completed stamp-off, and surfaces them until resolved. Cadence
   should ride an existing loop (coordinator closing ceremony / lean pass,
   babysitterd, or operator_runtime tick) — do not invent a fourth daemon.
3. **Ask the human before the official deal.** When the check (or the
   review ticket) is ready to mark a hotfix certified / close a sibling as
   `satisfied-by-hotfix`, the swarm must **ask the human first** (Approvals
   topic, Concierge, or existing approval-ask path) — not auto-close on
   green tests alone. The human's "deal officiel" is the certification
   moment.

## Why this exists now

Today the pattern is tribal and leaky:

- Land hotfix → sometimes file BL-811-shaped review → sometimes close the
  feature as `satisfied-by-hotfix` after human ruling (BL-810 / BL-811).
- Other hotfixes land with only a root intake ("needs swarm stamp") and no
  detector if the intake stalls: e.g. still-open
  `INTAKE-darwin-orphan-janitor-swarm-stamp.md` and
  `INTAKE-bubble-reply-volume-follows-phone.md` (2026-08-07).
- Briefings already complained about "ticket-less hand hotfixes accumulating
  in the master tree" (2026-08-04). Without a recurrent check, accumulation
  returns every time the human patches live.

## Locked human decisions (carry through)

1. **Certification = swarm review stamp-off**, not silent "it's been running
   for a day." Reuse BL-811 posture: review ticket is the quality gate;
   green unit tests alone are not enough.
2. **Recurrent check is mandatory** — one audit is not enough.
3. **Human ask before official deal** — before marking certified /
   `satisfied-by-hotfix` / archive of the stamp ticket as the lasting
   blessing, ask the human. Transient "hotfix is live for ops" may stay;
   "official swarm deal" may not auto-fire.
4. Specifier may choose the ledger shape (ticket field, evidence folder
   convention, small JSON under `.swarmforge/`, briefing section) — but
   something durable and greppable must exist so the check is not
   "remembered in chat."

## Specifier should decide (defaults welcome if human silent)

- **Where the check lives:** coordinator closing-ceremony / lean pass vs
  babysitterd finding vs operator_runtime nudge. Prefer coordinator+lean if
  that epic is live; else babysitterd WARN that names uncertified hotfixes.
- **How hotfixes are declared:** commit message tag, `notes:` on a ticket,
  `backlog/evidence/hotfix-*.md`, intake header "Operator hotfix already in
  the tree", or a small registry file. Pick one primary signal; document it.
- **What "uncertified" means operationally:** open stamp ticket missing /
  stamp ticket not done / human not yet asked for official deal.
- **Severity of the detector finding:** default medium WARN escalating to
  human ask; amend if you want high for production-path hotfixes only.

## Immediate open stamp debt (inventory seed — update at mint time)

Do not treat this list as complete; the minting pass should re-scan.

1. `backlog/INTAKE-darwin-orphan-janitor-swarm-stamp.md` — Darwin orphan
   janitor hotfix in tree; needs BL-811-shaped high review.
2. `backlog/INTAKE-bubble-reply-volume-follows-phone.md` — Bubble reply
   volume follows phone; needs stamp review.
3. Any other `Operator hotfix` / `satisfied-by-hotfix` / `hotfix-*.md`
   evidence without a done swarm-review sibling.

## Out of scope

- Re-implementing each hotfix from scratch (stamp-off reviews adopt/
   verify).
- Stopping the human from landing emergency patches (hotfixes may still
  land; certification must catch up).
- Model Steward "certify" (different altitude — model registry, not code
  hotfix stamp).
- Changing ambulance / expeditor ladders except where the human-ask for
  official deal reuses Approvals.

## Requested outcomes

1. Minted ticket(s) with Gherkin acceptance for: inventoriable hotfix
   signal, recurrent check fires when uncertified, human is asked before
   official deal, certified state is durable.
2. Open stamp intakes above drained into review tickets or linked as
   first debt the check must see.
3. Short how-to / protocol note: how to declare a hotfix, how the check
   finds it, how the human grants the official deal.
4. Optional: one Concierge / Approvals ask template for "certify hotfix X?"

## Urgency

Human ordered assurance that hotfixes do not stay uncertified, and that
the assurance is recurrent. Prefer same-shift mint + promote when the
active slot allows; otherwise pause-approved with priority ahead of
console polish.
