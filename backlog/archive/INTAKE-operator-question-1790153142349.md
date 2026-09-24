# Disposition (specifier, 2026-09-24)

Drained after one role_ask. The human answered A ("A - keep the docs pass as an
on-demand job (recommended)") and then corrected the ask itself: "About the
documentor as "not a seat": I probably messed up when I asked for that: I meant Art
Director." Minted: epic tracker **BL-1709** (on-demand-roles) and slice **BL-1710**
(the Art Director runs on demand; pending review), first minted for the documenter
in 435d4ad7cd and retargeted the same morning before any promotion. The documenter
stays a standing seat. The call contract is prompt prose in
swarmforge/roles/art-director.prompt. Both human sentences survive verbatim in
the tickets' `source:` (Article 5.3). Also the second input of the 2026-09-23
specifier A/B; see backlog/evidence/specifier-ab-20260923-arm-claude-opus-5-5-20260924.md.

---

# Intake: a question the Operator could not answer

Filed by the Operator (2026-09-23T08:45:42.349857107Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Make the documenter a callable ROLE rather than a standing pipeline seat - the shape the Model Steward and the Recruiter already have. (Human ask, 2026-09-23, LOCAL_AGENT topic, verbatim: "As for documentor: a bit like model steward or recruiter, it does not need to be a seat, more a role. It can be called by any agent who needs to publish something, typically like the documentor.")

The intent: any agent that needs to publish something invokes the documenter role out of band and gets the publish done, instead of the documenter holding a window, a worktree and a mailbox and receiving work through the handoff chain.

Operator grounding:
- Today the documenter IS a full seat: swarmforge/launch/documenter.sh, a window line in the pack, its own worktree, an inbox under .swarmforge/handoffs/documenter/inbox, and parcels route to it through the normal dispatch chain.
- The Model Steward and the Recruiter are the contrast shape: out-of-band jobs with no seat, no worktree, no mailbox and no parcel flow. The recruiter only makes OFFERS and never binds a seat, edits a pack conf, launches a pack or commits (BL-233).

Needs specifying, not assuming:
- Who may call the role, and what the call looks like (a CLI like the recruiter's, a note, or an inline capability every role prompt carries).
- What the publish contract is - what the caller supplies and what comes back - so a call cannot fabricate a publish the caller did not earn.
- What happens to the documenter's current queue and to its row in roles.tsv / the pack window list when the seat stops existing.
- Whether the morning-briefing job, which is documenter-owned by the human's ruling A of 2026-09-07, becomes a call of the same role or stays a separate scheduled job.
- Whether removing the seat frees a pack slot that another role should take, especially under the mono-router packs where active_backlog_max_depth is 1.
