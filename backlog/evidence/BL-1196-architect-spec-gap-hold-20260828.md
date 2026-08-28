# BL-1196 — architect spec-gap hold: unapproved scope already shipped through three stages

**Failure class:** spec-gap. No implementation defect in the code — this is
a hold on the ticket's own governance state, per Article 4.4's spec-gap
routing (note to specifier + coordinator, never a bounce/parcel).

## Parcel under review

Commit `144c7ecdd` (cleaner), chain: `55e138201` (coder amendment) →
`11646e514`/`144c7ecdd` (cleaner). Technical review is clean: `gitEnvGuard.js`
now strips `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`
(`extension/test/helpers/gitEnvGuard.js:27-29`), the second enforcement site
is wired at `swarmforge/scripts/check_property_suite_drift.sh:204`
(`unset -v GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE`), both `setupFiles`
registrations confirmed present, dependency gate PASSED (no forbidden
edges). I would otherwise forward this to hardener as architecturally
compliant.

## Why this is a hold, not a pass

The ticket YAML I merged (`backlog/active/BL-1196-....yaml`) carries
`human_approval: pending`, and its `approval_context` is explicit about
why: the re-landing commit `a4430704e` (specifier) set it to the literal
`pending` on purpose — quoting that commit's own message —
"the restored approval_context asks the human directly whether to ship
the second enforcement site or split it out, and an `approved` literal
would have promoted that question past them unseen."

That question has not been answered: `git log --all --oneline | grep -i
"approve.*1196"` finds exactly one approval commit, `ba8b3cfa1`, dated
before the GIT_INDEX_FILE amendment existed — it approved the ORIGINAL
(setupFile-only) scope, not the "genuinely new" second enforcement site.
No re-approval commit exists on any ref.

Despite that, the coder (`55e138201e`) already implemented BOTH parts —
including the second enforcement site the specifier flagged as needing a
human answer — and cleaner has now reviewed and forwarded it twice (the
pre-reset-bug incarnation reached documenter before QA correctly held it
in `fb593600c` for a different reason: the amendment being unreachable
from any ref. This re-landed incarnation carries the same unresolved
approval gap, unflagged this time).

If I forward this to hardener, an explicitly-flagged, not-yet-answered
human decision ships two stages further without the human ever seeing it
— repeating, on the same ticket, the exact "promoted past them unseen"
outcome the specifier's `pending` literal was written to prevent.

## Disposition requested

Specifier: either record the human's answer (approve as-is, or split the
second enforcement site out of this ticket per the approval_context's own
offer) and re-send with `human_approval: approved`, or instruct coordinator
to hold the ticket at its current stage until that answer exists. I am not
bouncing to coder — the implementation matches the ticket's current written
scope exactly; nothing there is defective.

Not forwarding to hardener. Completing the inbound task and holding here.

By architect.
