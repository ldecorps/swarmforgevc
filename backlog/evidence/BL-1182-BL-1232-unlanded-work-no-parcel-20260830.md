# BL-1182 and BL-1232: committed coder work, unlanded, with no live parcel — 2026-08-30

Raised by: specifier, from QA's priority-00 note
"BL-1284 landed tip-pure (BL-1241) - coder branch entangled with BL-1182+BL-1232".

## What QA's note reported, and what it turned out to mean

QA landed BL-1284 tip-pure onto `origin/main` per the BL-1241 remedy (b) ruling,
abandoning the coder tip `fa7d305367`. Its note named BL-1182 and BL-1232 as the
entangled siblings. Investigating those two siblings found a separate condition
that the note does not itself describe and that no role has yet acted on.

## The condition

Both tickets are `status: todo`, `assigned_to: coder`, sitting in
`backlog/active/`. Both have real implementation work committed on
`swarmforge-coder`. Neither is on `main`. **Neither has a parcel anywhere.**

| Ticket | Commit on `swarmforge-coder` | On `main`? |
|---|---|---|
| BL-1182 day-long BoB trial lifecycle | `f64ad3280` "revert the architect's revert and fix D1 and D2" | no |
| BL-1232 shift-velocity chart readable | `9c6200d72` "make the briefing shift-velocity chart readable at ordinary velocity" | no |

Verified by content, not by ancestry alone — each ticket's own
`required_wiring` anchor was grepped on both refs:

- BL-1232 `extension/src/metrics/briefingChartSvgCommon.ts::export function pickLabelIndicesByPixelGap`
  — **absent on `main`** (the file does not exist there), **present on `swarmforge-coder`** (1 match).
- BL-1182 `swarmforge/scripts/model_steward_cli.bb::trial`
  — **0 matches on `main`**, **68 matches on `swarmforge-coder`**.

Ancestry agrees: `git merge-base --is-ancestor f64ad3280 main` → no;
`git merge-base --is-ancestor 9c6200d72 main` → no.

## No parcel exists for either

Swept `inbox/new` and `inbox/in_process` for all eight roles across the master
checkout and every pipeline worktree (`.worktrees/{coder,cleaner,architect,
hardender,documenter,QA}`). The only live parcel in the entire swarm was this
specifier note. The tmux sessions for all eight roles are up, so the pipeline is
running and idle, not stopped mid-flight.

BL-1182 had already been bounced by the architect (`a0deb5f52`,
`53b4ae464` revert) and the coder had rebuilt against it (`f64ad3280`) — so the
work is a post-bounce rebuild, not an abandoned first attempt.

## What this is NOT

- **Not the BL-1273 stranding shape.** That was a commit with no ticket carrying
  it. Here both siblings have live active tickets, so their content is owned; what
  is missing is a parcel to carry it forward. The BL-1273 instance itself has since
  self-resolved — `205fdd36f` is now an ancestor of `main`.
- **Not a defect in QA's tip-pure land.** BL-1284's rebuild was correct and its
  abandoned tip `fa7d305367` is benign: the landed `a4d43634e` carries identical
  content, so the coder's next merge of `main` is a no-op for that row.
- **Not a spec defect in either ticket.** Both are human-approved, both passed
  their size-envelope adjudication, and neither has an unfixed spec-gap bounce.

## Disposition

Routing is the coordinator's, not the specifier's (Article 1.1 / specifier
"Does Not Own"). Surfaced to the coordinator by note. The decision the coordinator
owns is whether to re-dispatch BL-1182 and BL-1232 to the coder so the existing
commits are forwarded down the chain, before promoting further new work — two
active slots are already consumed by these two tickets.

No ticket minted: the condition is a dispatch gap with an owner, not an uncovered
defect. The reporting half of the entangled-sibling surface is already covered by
BL-1272 (paused).

By specifier.
