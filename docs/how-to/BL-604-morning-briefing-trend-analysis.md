# The Morning Briefing's Trend-Analysis Section (BL-604)

## What it is

The morning briefing gains a **narrative** section, distinct from the
rendered charts: a short, ranked list of bullets naming which behaviour
trends moved, in which direction, by how much, and a one-line "so what" —
not a re-plot of a chart. It reads e.g. "Approval-tap success fell from 98%
to 82% this week" rather than showing only the line that fell.

If you're looking for it in code: `extension/src/metrics/trendAnalysis.ts`
(the pure builder), `extension/src/tools/trend-analysis-section.ts` (the
thin compiled CLI that prints the section text — `main()` wraps the
exported helpers per the shared engineering rule), and
`trend-analysis-briefing-section` in `swarmforge/scripts/handoffd.bb` (the
two-line adapter wired into `briefing-email-sweep!`).

## The narrative renders the computed trend; it never forms one

Every bullet's direction and magnitude are `computeTrend`'s own
(`extension/src/metrics/trend.ts`) for the SAME series the mini-app's
[Trends board](BL-603-trends-published-on-mini-app.md) charts — nothing in
this section recomputes, smooths, or re-thresholds a delta. That is an
invariant, not a style choice: a bullet that disagreed with the chart beside
it would leave no way to tell which one lied. The one-line "so what" is
about the SHAPE of the change only — this module carries no per-series
notion of whether a direction is good or bad news; a series that wants "up
is bad" says so in its own label, not in this builder.

The builder maps over the same `TRENDS_BOARD_SERIES` registry
(`extension/src/metrics/trendsBoardRegistry.ts`) the board uses and carries
no second per-series list of its own — registering a series for the board
(see [Registering a series](BL-603-trends-published-on-mini-app.md#registering-a-series))
is the same edit that makes it eligible for the narrative.

## Absence of data is never a finding

A series appears in the section **if and only if** `computeTrend` returns a
direction other than `unknown` for it — fewer than two points is precisely
`unknown`, so the omission rule needs no threshold of its own. A series with
no landed producer, or whose loader throws, arrives as an empty array
through the shared `loadPointsSafely` and falls out through the same
`unknown` clause with no extra branch. Nothing is ever reported as "flat, no
change" for a series that was never actually measured — that would read as
evidence nothing happened, when the truth is nobody looked. When the
analysis has no bullets at all, the CLI prints nothing rather than a heading
with no bullets beneath it; a bare heading is that same false report wearing
a hat.

## Ranking: relative, not absolute

Bullets are ranked by `|delta / prior|` (a proportional move), not `|delta|`
(an absolute one) — an absolute ranking would let whichever series is
measured in the largest units (e.g. a token count) outrank every other move
forever, no matter how small the relative shift. A `prior` of zero has no
ratio, so the absolute delta stands in for that one case. Ties break on
series id, so an unchanged day renders identically rather than reading as
movement that did not happen. The section is bounded in length and leads
with the largest mover — the briefing is a phone read.

## Where this plugs into the send

`swarmforge/scripts/briefing_email_lib.bb` holds an ordered
`optional-section-adapter-keys` vector; adding a section is a new entry in
that vector, never a new branch. This ticket added
`:trend-analysis-section`, and `handoffd.bb`'s `briefing-email-sweep!`
supplies its adapter — the same two-line shape every other optional section
(the shift-velocity chart, the burndown chart, the architecture diagrams)
already uses. A key with no adapter behind it (or the reverse) is a section
built and callable by hand but reachable from nowhere — the same BL-419
failure mode BL-1184 and BL-896's sections guard against.

## Failure degrades, never crashes the send

A throwing loader for one series costs that series its own bullet and
nothing else (BL-260 posture) — the briefing still sends with every other
section intact. This mirrors the fail-open independence the [shift-velocity
chart](BL-1184-briefing-shift-velocity-chart.md#fail-open-independence--now-three-sources-not-two)
and the open-ticket chart already establish for their own render sources.

## Verifying

1. Trigger a briefing send and open the email. Confirm a trend-analysis
   section appears, bulleted, each line naming a direction, a magnitude, and
   a one-line significance — and that it is ranked with the largest
   proportional mover first.
2. Confirm a series with fewer than two data points (or an unlanded
   producer) carries no bullet anywhere in the body — never a "flat/no
   change" line.
3. Break one series' loader deliberately (make it throw) and confirm the
   briefing still sends: every other section (including this one, minus
   that series' bullet) arrives intact.
4. With every series absent or unlanded, confirm the section renders no
   heading at all rather than an empty one, and the send still succeeds.

## Related

- [Behaviour-trend series on the live Mini App console](BL-603-trends-published-on-mini-app.md)
  — the registry and `computeTrend` framework this section is a second,
  narrative consumer of; charts stay unchanged and this ticket touches no
  producer.
- [The Morning Briefing's Shift-Velocity Chart](BL-1184-briefing-shift-velocity-chart.md)
  — a sibling optional briefing section sharing the same
  `optional-section-adapter-keys` seam and fail-open posture.

Acceptance: `specs/features/BL-604-morning-briefing-trend-analysis.feature`.
