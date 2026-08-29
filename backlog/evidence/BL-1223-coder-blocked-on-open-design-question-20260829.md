# BL-1223 — coder blocked on approval_context's open design question, 20260829

## Why this isn't a coder judgment call

BL-1223's `approval_context` poses two questions. The first ("narrowing
dispatch evidence trades silent starvation for a visible double route") is
the coder's-call shape seen elsewhere in this backlog (e.g. BL-1256): a
stated default, confirm-or-object. The second is phrased differently and
deliberately so:

> Second, which note forms genuinely dispatch work... If the answer is "the
> router's own emitted forms are the only notes that count, and hand
> kickoffs must adopt one of them", say so and this becomes a one-sitting
> fix; if hand kickoffs must keep working as-is, the discriminator needs to
> be structural rather than textual and **the coder should know that before
> starting**.

That closing clause is explicit: this fork changes the SHAPE of the fix
(textual verb-first filter vs. a structural discriminator), not just a
parameter within one shape, and the ticket says the coder should know the
answer before starting - i.e. it is not delegated the way the first
question is.

## What I checked before writing this

- Searched this checkout for a role_ask/answer record naming BL-1223: none.
- Searched `backlog/` broadly for any note answering question 2: none.
- The ticket's own `notes:` field (five entries, latest 2026-08-29) records
  measurement and a restoration incident, never an answer to this question.
- The four handoffs BL-1223 cites as evidence
  (`.swarmforge/handoffs/{specifier,coordinator}/sent/...`) are runtime
  mailbox files, not git-tracked, and are gone from my coder worktree (they
  were never here - master-resident mailboxes only exist on the master
  checkout, and by now are 2 days old, plausibly rotated/pruned there too).
  I can reason from the ticket's own quoted message text and this
  project's documented handoff conventions, but I cannot re-derive the
  `to:` header on each historical example to independently verify a
  structural (recipient-based) design before committing to it.

## The two shapes, concretely

1. **Textual, one-sitting fix**: in `collect-dispatched-ticket-ids`
   (`chase_sweep_lib.bb`), for a `note`'s `message:` field, count it only
   when it matches the existing verb-first `Spec|Work` pattern
   (`extract-ticket-id`'s second branch) - never the general leading-id
   pattern. `extract-ticket-id` itself stays unchanged (11 other call
   sites depend on it); only this ONE call site's use of it narrows.
   Consequence: the documented BL-259 hand-kickoff shape ("BL-259 active:
   build gated dependency-rule checker + steps", no verb marker) would stop
   counting as dispatched - a hand kickoff written that way would either
   need to adopt a verb-first form, or would occasionally get double-routed
   (visible, recoverable, per the ticket's own accepted trade-off) rather
   than silently starved.

2. **Structural discriminator**: filter on something other than the
   message text - the candidate I was about to build is the note's `to:`
   recipient set: a note whose recipients are entirely master-resident
   roles (coordinator, specifier) is a status/bookkeeping report and never
   counts; a note addressed to at least one working pipeline role (coder,
   cleaner, architect, hardener, documenter, QA) counts, verb marker or
   not - this preserves the BL-259 hand-kickoff shape without requiring it
   to adopt router phrasing. I have NOT implemented this - I could not
   verify it against the four real cited handoffs (see above), and it is
   a larger, less "one-sitting" change than option 1.

## What I need

A specifier ruling on which shape to build, the way the ticket's own
approval_context asks for. Routing this as a `note` rather than guessing,
per Article 4.4 ("spec gaps leave by note, priority 00, never a parcel")
and this ticket's own explicit "the coder should know that before
starting."

By coder.
