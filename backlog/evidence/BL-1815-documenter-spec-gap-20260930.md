# BL-1815 — documenter spec-gap note, 2026-09-30

## What happened

The first pass's doc paragraph on `docs/how-to/BL-547-model-steward-overview.md`
(covering the Claude-to-local-model knowledge brief) was dropped when QA
bounced the parcel for D1/D2 (coder-blamed) and reverted the whole bounced
parcel per Article 2.3.2. After the coder/cleaner/architect/hardener rebuild
reached documenter again, merging hardender's inbound commit into my branch
(merge `0f53cbaa02`) silently dropped my own prior uncontested addition of
that paragraph — the shape `merge_drop_guard_lib.bb` (BL-1576) exists to
catch.

## What I tried

Re-added the paragraph (updated for the coder's D1/D2 fixes) as a plain
commit. `swarm_handoff.sh` refused at send time: the merge-drop guard
found my forwarded blob for that path differs from what I received, so it
is not excused, and it named the documented remedy — "carry a proper
revert of the commit that authored the dropped hunk" (a `git revert` of
my own earlier commit `9e66389f12`, whose message contains `This reverts
commit <sha>`, which `revert-excuses?` looks for).

Attempting that revert tripped a DIFFERENT guard,
`check_bounce_revert_scope.sh` (BL-1471), at commit time: it fires on any
commit whose subject starts with `Revert "`, and its ticket-attribution
falls through to "the ticket with the latest bounce record overall" when
the reverted commit is not a merge (my single-commit revert has no
second parent, so the merge-specific attribution paths never fire). It
attributed my revert to BL-1820 (an unrelated, more recently bounced
ticket) instead of BL-1815, and refused the commit.

## Disposition

Withdrew the paragraph instead (`31f6a7fb63`): `docs/how-to/BL-547-...md`
is now byte-identical to what I received from hardender, which the
merge-drop guard's blob-identity exemption accepts. BL-1815 forwards to
QA without the doc addition.

## What's owed

1. The doc content itself is accurate and still belongs in
   `docs/how-to/BL-547-model-steward-overview.md` (the paragraph text is
   preserved in this session's history at commit `4552cc4594` for
   reference) — a follow-on documenter pass, once BL-1815 lands, can add
   it fresh against a `received` baseline that no longer disagrees.
2. `check_bounce_revert_scope.sh`'s ticket-attribution has a real gap:
   its non-merge fallback (`latest_bounce_ticket_overall`) can misattribute
   any single-commit `Revert "..."` to an unrelated ticket, refusing a
   legitimate BL-1576-remedy revert. This is a guard-interaction gap, not
   this ticket's to fix.

By documenter.
