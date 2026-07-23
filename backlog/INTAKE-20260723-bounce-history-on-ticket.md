# Human directive — persist bounce history (count + reason) durably on the ticket itself

**From:** human (via Claude Code coordinator session)
**Date:** 2026-07-23
**Authority:** human-requested (general capability, not specific to BL-606)

## Problem

Right now a ticket's bounce history is split across two places, neither of
which is the ticket's own record, and neither of which gives a quick answer to
"how many times has this bounced, and why":

1. **Free-form evidence files**, `backlog/evidence/<TICKET-ID>-*.md`, written
   by hand per bounce. Naming is inconsistent — sequential
   (`BL-606-architect-bounce.md`, `-bounce-2.md`, `-bounce-3.md`) vs. dated
   (`BL-419-shared-checkout-commit-integrity-bounce-20260717.md`) — so even
   finding all of a ticket's bounce files requires a loose glob, not an exact
   pattern.
2. **An aggregate, host-local, gitignored JSONL log**,
   `.swarmforge/qa_bounces/<YYYY-MM>.jsonl`, written by
   `extension/src/tools/record-qa-bounce.ts` (its own usage comment: appends a
   record "after QA hand-writes" the evidence file). This is what produces
   metrics like `qa_bounce:behavior:coder count=31`
   (`extension/src/metrics/failureModeInventory.ts:100-124`,
   `recordsFromQaBounceJsonl`) — but it's an aggregate signal for
   swarm-health reporting, not a per-ticket, git-visible record, and it never
   persists to the ticket's own YAML.

**Nothing on the ticket's own `backlog/active/<id>.yaml` today records bounce
count or reason.** Confirmed by direct grep — no `bounce_count`,
`bounce_history`, `rejected_count`, or similar field exists anywhere in
`backlog/active/*.yaml` or `backlog/done/*.yaml`. Reviewing a ticket's own
record gives no signal that it bounced three times, or why, without separately
hunting down its evidence files by a naming convention that isn't even
consistent.

This is the same class of gap BL-606 exists to close for stage-skipping
(making skips visible/auditable on the ticket record itself, not just in a
diff) — bounce history deserves the same treatment.

## What already exists (reuse where it fits)

- `record-qa-bounce.ts` (compiled to `extension/out/tools/record-qa-bounce.js`)
  is the one place a ticket ID + bounce metadata (failure class, producing
  role, commit) are already assembled at bounce time, across whichever
  worktree branch is reviewing — see its `parseArgs`/`validatedFields`
  (~lines 53-77) and `main` (~line 84). **This is the natural wiring point**
  to add a companion write into the ticket's own YAML, rather than inventing a
  second bounce-recording code path.
- `qaBounceEvidenceParser.ts` (`parseBounceEvidenceFile`, ~line 211) already
  parses evidence-file prose into structured data (used historically by
  `backfill-qa-bounces.ts`) — useful precedent for whatever structured shape
  a new `bounce_history:` entry takes.
- There is **no existing precedent for a true multi-entry, accumulating
  structured list** on a ticket's own YAML — `promotion_blockers:` is the
  closest existing field but is a single folded-scalar block
  (`backlog/hold/BL-548-*.yaml:19-24`), not a growing list.
  `stage_skip_reasons:` (BL-606's own design) is the closest DESIGN precedent
  for the shape wanted here, but it is itself still unbuilt as of this intake
  — cite it as precedent, not as an existing implementation to copy from.

## Open questions for the specifier to resolve in the spec

- Exact field shape: a `bounce_history:` list of structured entries (date,
  bouncing role, producing role, failure class, evidence file path) vs. a
  simpler running `bounce_count:` + `last_bounce_reason:` pair. A full history
  list is more useful for audit but is the FIRST true accumulating structured
  list this project's ticket schema would have — worth being deliberate about
  the shape since it may set precedent for BL-606's own not-yet-built
  `stage_skip_reasons:`.
- Does this write need to happen from every worktree branch mid-review (before
  the ticket's own YAML on that branch has necessarily seen the bounce), or
  only once the bounce commit reaches `main`? A bounce currently happens on
  whichever role's branch is reviewing, well before that content is anywhere
  near `backlog/active/`'s canonical copy on `main` — the specifier needs to
  design how/when the persisted field actually lands on the ticket's real
  record without racing concurrent bounces or requiring every reviewer role to
  learn a new write step by hand.
- Should this subsume or feed the existing gitignored JSONL aggregate
  (`.swarmforge/qa_bounces/`), replace it, or run alongside it as a
  git-visible companion? The JSONL is useful for swarm-wide metrics
  (`qa_bounce:behavior:coder count=31`-style); the new field is for
  per-ticket visibility — likely both are wanted, but the specifier should
  decide whether one derives from the other or they're independently written.

## Proposed ticket

Specifier: drain this intake into a properly-scoped ticket in `backlog/paused/`
with a Gherkin feature under `specs/features/`. `human_approval` still
required before promotion.
