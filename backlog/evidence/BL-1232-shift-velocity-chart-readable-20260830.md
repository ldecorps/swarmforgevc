# BL-1232 — the briefing shift-velocity chart is readable at ordinary velocity

Coder, 2026-08-30. Rendering only: the metric and the non-linear time axis are
BL-1184's contracts and neither moved.

## The three failures, and the one line behind two of them

**Failures 2 and 3 were the same line.** `nonLinearTimeX` took the log of raw
age in milliseconds:

```ts
const t = Math.log(1 + age) / Math.log(1 + maxAge);
```

That divides by the span OUTSIDE the log, so the curve's shape depends on the
units age happens to be measured in. Over a thirty-day series the one-day-old
point landed at ~16% of the plot width and today at 100%: one hop consumed 84%
of the chart (failure 3) and the other twenty-nine days were packed into the
leftmost sixth, where index-picked labels then stacked on each other (failure
2).

Normalizing age into 0..1 before the log makes the warp a property of the
series' shape rather than of the clock's units:

```ts
const normalizedAge = Math.min(Math.max(age / maxAge, 0), 1);
const t = Math.log(1 + TIME_WARP_K * normalizedAge) / Math.log(1 + TIME_WARP_K);
```

`TIME_WARP_K = 9` is the whole knob: at k → 0 the axis is linear, and larger k
gives the recent end more room. Measured over thirty days, the widest
day-to-day hop is now under half the plot, the oldest day still plots leftmost,
the newest rightmost, the mapping stays monotonic, and
`hasNonLinearTimeSpacing` still reports true — BL-1184's locked contract is
that the axis is non-linear, not that it is violent.

**Failure 1** is the soft cap: `shiftVelocityAxisPlan` derives a robust body
bound and, when the peak materially exceeds it, sets the axis from the bound
and draws the over-cap day as a distinct marker on the cap line carrying its
true value. When the peak does not exceed the bound, behaviour is exactly as
before — axis covers the peak, nothing clipped, no markers.

**Labels** now come from `pickLabelIndicesByPixelGap` in
`briefingChartSvgCommon.ts`, picked by where points actually plot: the most
recent always keeps its label, then a right-to-left greedy walk accepts a
candidate that clears `MIN_DATE_LABEL_GAP_PX`. That constant is derived, not
chosen — a `YYYY-MM-DD` label is 10 chars at font-size 11 monospace (~0.6em
advance, ~66px) and 72px is that plus a gutter.

## The body bound took two attempts, and the property found the first one

The ticket suggests "a high percentile, or a multiple of the median". The 90th
percentile doubled was written first. Invariant 1's property failed on its
first run at a five-day series: with n=5 the 90th percentile IS the outlier, so
the cap tracked the very value it exists to contain.

The shipped bound is `max(median × 3, p75 × 2, 1)`. The median term survives a
single freak day; the p75 term survives the opposite shape — a genuinely
bimodal week where half the days really are busy and clipping them all would be
the misreading.

## An honest limit of the mechanism, stated rather than hidden

`niceChartAxisMax` rounds the body bound up, and occasionally that rounding
lands above the outlier — a body bound of 46 becomes an axis of 100, which
covers a peak of 79. Nothing is then off-scale and nothing is clipped, which is
correct (no value is dropped or flattened) but is not "the axis fits the body".
The invariant asserted is therefore the one that matters: **every value above
the DRAWN axis carries a marker with its true value**, and no marker is drawn
when nothing is off-scale. Scenario 01 still asserts the axis tracks the
ordinary days for the 400-against-sub-30 shape the intake photographed.

## The declared invariants (BL-654)

`extension/test/bl1232ShiftVelocityChartInvariants.property.test.js`.

**Invariant 2's first property was vacuous, and the fix is recorded because the
finding is the interesting part.** The end-to-end version — render the real
chart over drawn series lengths, assert no two labels crowd — was measured
against the ORIGINAL index-thirds picker and stayed **green**: under the
normalized warp, first/mid/last are already comfortably spaced. A property that
cannot fail against the defect it names proves nothing about it.

So the load-bearing half quantifies over the PICKER against CLUSTERED layouts
built to crowd (all but the newest few points packed into a narrow band — the
shape the old warp produced), and each draw also checks that index-thirds WOULD
have violated the gap, with a reach floor of 40 such discriminating draws. The
end-to-end property is kept as the wiring check it honestly is.

**Non-vacuity, each shown by breaking the code and running:**

| invariant | break | result |
|---|---|---|
| 1 | the clipped marker prints the cap instead of the true value | FAILS: "the value 13 is above the axis 2 and carries no marker text" |
| 2 | the picker returns index thirds again | FAILS: "picked labels at 0 and 2 are inside the 72px gap" |
| 3 | the warp goes linear | FAILS: "10 days of history reported linear spacing" |

All three restored; 6/6 green.

## Runs

| what | result |
|---|---|
| BL-1232 unit tests | 15/15 |
| BL-1232 property tests | 6/6 |
| BL-1232 acceptance | 6/6 |
| BL-1184 acceptance (`non-linear-time-axis-04` included) | 6/6 |
| BL-1184's own unit tests (`shiftVelocity.test.js`) | 17/17 |
| BL-1184's invariants property | 3/3 |
| standing collision and mkdtemp guards | 18/18 |

## What is left for whoever reviews the picture

The ticket's e2e procedure asks for a rendered PNG opened by eye against the
live repo. That is a human judgment about a picture and this parcel cannot make
it — every measurable claim behind it is asserted above (axis tracks the body,
peak carries its value, no two labels inside 72px, no hop over half the plot,
oldest leftmost and newest rightmost). QA running step (1) is what closes it.

## Out of scope, untouched

The 8h window, the aggregation and the lifecycle adapter (BL-1184); the
non-linear axis itself; the burndown and architecture charts — only the shared
picker lands in `briefingChartSvgCommon.ts`, and wiring the burndown to it is
somebody's separate ticket; and the `/tmp` fixture leak in
`bl1184BriefingShiftVelocitySteps.js`, which is BL-1226's.
