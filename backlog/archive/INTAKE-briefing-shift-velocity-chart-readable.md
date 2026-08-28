# INTAKE — Morning-briefing shift-velocity chart is unreadable

**Source:** human via Cursor, 2026-08-28 ~06:43 BST  
**Surface:** morning briefing email chart — `extension/src/metrics/shiftVelocityChart.ts`
(`buildShiftVelocitySvg` / BL-1184). Same render lands in the daily briefing
as **"Shift velocity — max tickets landed per 8h."**

Status: **new intake, not minted.** Specifier: mint a follow-on polish /
defect ticket against BL-1184's chart renderer. Metric definition stays
locked (max tickets landed per rolling 8h stretch per day); this intake is
**render readability only**.

## Why this is in front of you

The live chart from today's briefing is effectively unreadable for the
activity that matters. Screenshot:

`backlog/evidence/INTAKE-shift-velocity-chart-unreadable-20260828.jpg`

Subtitle on the chart: `Peak 415 tickets / 8h stretch · non-linear time
(recent detail)`.

Three concrete failures visible on that render:

1. **Y-scale crushed by one outlier.** A single ~415 peak forces the axis
   to ~0–500. Ordinary days (roughly under ~30) sit as a flat line on the
   floor — recent detail the subtitle promises is invisible.
2. **X-axis date labels collide.** Early dates (around `2026-07-29`) stack
   on top of each other on the left and cannot be read. Labels are picked
   by series index (`0`, mid, last) with no minimum pixel gap, so the
   log-age warp packs the first two onto the same strip of pixels.
3. **Long sparse tail wastes the right half.** After the dense early
   cluster, a near-zero line stretches across most of the plot width to
   `2026-08-28`, so the "recent detail" claim of the non-linear axis is
   not delivering readable recent shape either.

## Goal

Mint a ticket that makes the chart readable for typical day-to-day velocity
without lying about the peak:

1. Y axis must show the body of the series (typical days), not only the
   single max. Peak remains named (subtitle already does) and must stay
   findable on the chart (callout / clipped marker / broken axis — specifier
   chooses the shape).
2. X-axis date labels must not overlap — pick labels by minimum pixel
   spacing (or equivalent), not raw index thirds alone.
3. Keep the locked metric and the non-linear time axis contract from
   BL-1184 / `docs/how-to/BL-1184-briefing-shift-velocity-chart.md`; change
   rendering, not the series definition.

## Locked human decisions

1. **Make this chart readable** — the current briefing render is not
   acceptable as-is.
2. Do **not** change what the series measures (still max landed per rolling
   8h window per calendar day).
3. Specifier chooses the Y-axis remediation shape (clip+callout vs broken
   axis vs soft-cap with peak annotation, etc.) as long as ordinary days
   are visually resolvable and the peak is not silently erased.

## Out of scope for this intake

- Changing the 8h window or the lifecycle adapter.
- Reworking the burndown or architecture briefing charts (unless a shared
  label-spacing helper in `briefingChartSvgCommon.ts` is the cleanest
  home — specifier's call).
- Removing the non-linear time axis.

## Pointers

- Renderer: `extension/src/metrics/shiftVelocityChart.ts`
- Shared axis helper: `extension/src/metrics/briefingChartSvgCommon.ts`
- How-to: `docs/how-to/BL-1184-briefing-shift-velocity-chart.md`
- Closed parent: `backlog/done/BL-1184-briefing-shift-velocity.yaml`
- Evidence: `backlog/evidence/INTAKE-shift-velocity-chart-unreadable-20260828.jpg`

---

**Dispositioned 2026-08-28 by specifier:** minted as **BL-1232**
(`backlog/paused/BL-1232-shift-velocity-chart-readable.yaml`,
acceptance `specs/features/BL-1232-shift-velocity-chart-readable.feature`).
One intake, one ticket — no merge, no split. All three locked human decisions
carried into the ticket verbatim; Y-axis remediation shape chosen per locked
decision 3 = soft cap with clipped-peak callout.
