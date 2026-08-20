# BL-910 vs BL-896 scenario 01 — BL-896's criterion is STALE, and BL-910's text must NOT be changed

Raised by: hardener (priority-00 note 20260820T011810Z_000255), "BL-910's 'no ETA' text
breaks BL-896 acceptance 01". **Coordinator verified: the collision is real, but the
framing understates it — and the obvious fix is the wrong one.**

## The assertion
`specs/pipeline/steps/bl896BriefingOpenTicketChartSteps.js:131`

    registry.define(/^it projects no completion date$/, (ctx) => {
      if (/complet/i.test(ctx.burndownSvg) || /\bETA\b/i.test(ctx.burndownSvg)) throw ...
    });

It is a blanket textual ban on the token `ETA` (and `complet`) anywhere in the rendered
SVG — a crude proxy for the intent "makes no claim of progress toward a fixed scope".

## It breaks TWO ways, not one
1. **Token collision (what the hardener saw):** BL-910 renders
   `'no ETA — backlog still growing'`, which contains `ETA`, so `/\bETA\b/i` fires even
   though that string projects no completion date at all. A false positive.
2. **Genuine, intended conflict (the bigger half):** when net burn > 0 BL-910 renders a
   real calendar date. That *is* a projected completion date, and it would fail the same
   assertion for the right reason. Rewording the "no ETA" string does not touch this case.

## Why BL-896's criterion is stale, not violated
BL-910 is not a rogue feature. BL-896's own ticket is `direction: human-requested`, and
BL-910 records the human's explicit instruction verbatim: *"Parent / sibling: BL-896 ...
Do not fold this into BL-896 — that ticket is a review stamp (F1-F4); this is new
product. Mint a small follow-on."* The human commissioned an ETA on this very chart
after BL-896 was written. BL-896's "projects no completion date" therefore encodes a
state the human has since superseded — it is a stale acceptance criterion, and BL-896 is
already closed to `backlog/done/M8`.

## Do NOT "fix" this by rewording BL-910
The string is human-verbatim and load-bearing: *"If net burn <= 0, render 'no ETA —
backlog still growing' (never 'never', never a fabricated infinity)."* Changing it to
dodge a regex would edit a human's sentence to satisfy a stale machine assertion —
precisely what Article 5.3 forbids. It also fixes only failure mode 1 of 2.

## What is actually needed (specifier's call; may need a human ruling)
Narrow BL-896 scenario 01 to what it MEANT — no claim of progress toward a fixed or
committed scope, no fabricated completion date — so a net-flow ETA and the explicit
"no ETA" string both pass. Note this amends the acceptance of a CLOSED, human-directed
ticket, which is why it is routed rather than decided here.

Coordinator did not touch BL-910 (in flight at hardener), BL-896, or the step file.
