# BL-1241 — coder blocked on approval_context's open remedy choice, 20260829

## Why this isn't a coder judgment call

BL-1241's own `approval_context` opens with: "This ticket deliberately does
NOT choose the remedy, because the choice is yours and the options differ
in cost... Say which you want before this is built; the scenarios gate the
OUTCOME, not the mechanism, so any of the three satisfies them."

Three named remedies, with materially different implementation shapes and
costs:
- (a) Land approved siblings first, in dependency order.
- (b) Have the land step build a tip-pure commit by replaying only the
  ticket's own paths onto origin/main (partly built already per the
  2026-08-28 note - `abandoned_commits:` override + BL-1227's own
  `af55356bd` rebuild - but the LAND STEP naming/directing that move does
  not exist yet).
- (c) A per-ticket branch off origin/main - the real fix, but contradicts
  Article 1's one-worktree-per-role rule and needs an Article 5
  amendment.

This is explicitly the SAME shape as BL-1223's second approval_context
question (a fork that changes the shape of the fix, not a coder's-call
default) - and unlike BL-1223, this ticket's own notes confirm **no
ruling has landed**:

> [2026-08-29] specifier: "...What is missing is not a spec, it is the
> human's answer to the approval_context question above, which has now
> been open for a day while the defect fired twice more. I could not
> raise it: one clarifying question is already pending for this role...
> and only one may be outstanding at a time."

I re-checked the full ticket file (186 lines) for any later ruling note
and found none - the specifier's own most recent entry is still reporting
the question as open and unraised.

## Current cost of guessing wrong

- (a)/(b)/(c) are not interchangeable: (b) is "substantially cheaper" per
  the specifier's own material-update note (partly built already), but
  (c) requires an Article 5 constitutional amendment the coder cannot
  authorize, and building (a) or (b) when the human wanted (c) - or vice
  versa - wastes real parcel cost the specifier's own approval_context
  explicitly asked to avoid ("differ in cost").
- The specifier's own prose-half commitment (swarmforge/roles/QA.prompt
  amendment) is ALSO gated on this same answer and explicitly not written
  yet - building code for a remedy the QA.prompt then never directs to
  would leave the mechanism live but unused, the same "adjudicated but
  not enforced" shape BL-1258 (my prior parcel) was just filed to close.

## What I need

The specifier (or whoever now holds the pending human question) to land
the remedy ruling on this ticket, the same way BL-1223 received one
today. Routing as a `note` rather than guessing, per Article 4.4 and this
ticket's own explicit "say which you want before this is built."

By coder.
