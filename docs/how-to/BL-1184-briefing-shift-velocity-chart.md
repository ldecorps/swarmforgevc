# The Morning Briefing's Shift-Velocity Chart

## What it is

The morning briefing email carries a third rendered chart alongside the
architecture diagrams and the [open-ticket burndown
chart](BL-896-briefing-open-ticket-chart.md): a per-day line of the busiest
**8-consecutive-hour stretch** for landing work — "shift velocity." It
answers "what was our hardest 8-hour shift?", not "how many tickets are
open" (that's the burndown chart) and not "how fast is the backlog draining"
(same chart, different question). It renders as SVG, converts to a
`cid`-attached PNG the same way the other two diagram families do, and gets
its own `<h3>` section: **"Shift velocity — max tickets landed per 8h."**

If you're looking for it in code: `extension/src/metrics/shiftVelocity.ts`
(the series), `shiftVelocityChart.ts` (the SVG/PNG), and
`extension/src/tools/render-briefing-shift-velocity.ts` (the briefing CLI
shell-out, same `[{name, base64}]` contract as
`render-briefing-burndown.js`).

## The metric (locked by human ruling)

One point per calendar day: the **maximum** count of tickets landed
(`backlog/done/` close events only — never open-count, never intake) inside
any rolling 8-hour window overlapping that day. `maxRollingEightHourLandedForDay`
slides the 8-hour window in 1-hour steps across the day and keeps the
highest count it sees — not a fixed shift-aligned block. That is a
deliberate default (one chartable point per day that answers "hardest
8-hour stretch"), not a limitation; there is exactly one series definition,
shared by the chart and the telemetry record below.

## Where the data comes from

`buildShiftVelocityFromGitHistory` reads through the **same**
`deriveTicketLifecycles` adapter every other briefing chart uses — no
second backlog-history reader (this is an explicit ticket invariant, and an
acceptance scenario asserts it). When the briefing's shared [lifecycle
snapshot](BL-897-briefing-lifecycle-snapshot.md) is available, the CLI reads
that instead of re-walking git history itself.

Git history backfills as far back as `backlog/done/` close events go. Going
forward, each send also appends today's point to an optional, append-only
`shift-velocity-YYYY-MM.jsonl` telemetry log
(`shiftVelocityTelemetryStore.ts`) — the log exists so a future point that
git history alone can't reconstruct (e.g. a close event git would
undercount) still has a durable, forward-captured record. It is a capture
mechanism, not an alternate reader: today's chart still derives from
lifecycles, not from replaying the log.

## The non-linear time axis

Unlike the burndown chart's linear day axis, this chart deliberately warps
time: `nonLinearTimeX` places each day using a logarithmic age transform
over age NORMALIZED to `0..1` first —
`log(1 + TIME_WARP_K * (age / maxAge)) / log(1 + TIME_WARP_K)`, `TIME_WARP_K
= 9` — so older days compress toward the left and recent days spread out
with more pixel precision, without one hop consuming most of the plot
(BL-1232: an earlier version took the log of raw age in milliseconds, which
made the curve's shape depend on the clock's units — over a 30-day series
one hop could consume ~84% of the plot width). `maxAge` floors at 1 so a
single-day series doesn't divide by zero. `hasNonLinearTimeSpacing` is the
check used to assert the spacing is genuinely unequal (not a
coincidentally-even linear axis) — consecutive point gaps must differ by
more than 2% of the plot width between the oldest and newest pair.

Date labels are picked by `pickLabelIndicesByPixelGap`
(`briefingChartSvgCommon.ts`, shared with any future caller — BL-1232) by
where points actually plot, not by series index: the most recent day always
keeps its label, then a right-to-left walk accepts a candidate once it
clears a minimum pixel gap from an already-picked neighbour (~72px, the
rendered width of a `YYYY-MM-DD` label at font-size 11 monospace plus a
gutter) — so labels never stack on each other regardless of how the warp
clusters points.

## The Y axis: soft cap with a clipped-peak marker (BL-1232)

Y is linear (`niceChartAxisMax`, the same helper the burndown chart uses via
the shared `briefingChartSvgCommon.ts` module), but the axis maximum is no
longer simply the series peak. `shiftVelocityAxisPlan` derives a robust body
bound from the series — `max(median × 3, p75 × 2, 1)` — and when the true
peak materially exceeds that bound, the axis is drawn from the bound instead
of the peak: an outlier day (the chart's original failure — a single ~415
day flattening every ordinary sub-30 day to the floor) no longer crushes the
scale for the rest of the series. A day whose value sits above the drawn
axis renders as a distinct clipped marker sitting on the cap line, carrying
its true value as text — no value is ever silently dropped or flattened.
When the peak does not materially exceed the body bound, the axis behaves
exactly as it always did: it covers the true peak, and nothing is clipped.

## Fail-open independence — now three sources, not two

[BL-896's doc](BL-896-briefing-open-ticket-chart.md#fail-open-independence-from-the-architecture-diagrams)
describes `diagram-section-from-sources` wrapping two render sources
(architecture, burndown) each in its own `try`/`catch`. BL-1184 added a
**third**, optional source parameter — `shift-velocity-source-fn` — with
the same contract: it is `try`/`catch`-wrapped independently, defaults to
`nil` when the caller doesn't pass one (existing two-source callers are
unaffected), and its result is concatenated in only if present. Any
combination of the three succeeding, throwing, or returning empty still
ships whichever succeeded — never all-or-nothing. `diagram-note-line` in
`briefing_email_lib.bb` covers all the resulting combinations (all three;
burndown+shift only; shift alone; etc.) with its own plaintext sentence, so
a plaintext-only client always gets an accurate note regardless of which
subset rendered.

In `handoffd.bb`, `briefing-shift-velocity-json` is its own shell-out to
`render-briefing-shift-velocity.js` — a standing-tracker-style call
alongside `briefing-diagrams-json` and `briefing-burndown-json`, not a
branch inside either.

## Verifying

1. Trigger a briefing send and open the email. Confirm a third chart section
   appears headed "Shift velocity — max tickets landed per 8h", with a
   subtitle naming the peak count and window.
2. Confirm the x-axis spacing is visibly denser on the right (recent days)
   than the left (older days) once the history spans more than a handful of
   days, that no two date labels overlap, and that ordinary days are
   visually resolvable rather than flat on the floor. If the series has a
   day whose value materially exceeds the rest, confirm it renders as a
   distinct marker on the cap line carrying its true value, not silently
   flattened into the axis.
3. Rename `extension/out/tools/render-briefing-shift-velocity.js` aside and
   send — confirm the architecture diagrams and burndown chart still
   arrive, and the plaintext note no longer mentions shift velocity.
   Restore it.
4. With all three renderers broken, confirm the email still sends
   (plaintext note, no attachments) rather than failing the send.
5. Check `.swarmforge/telemetry/shift-velocity-<YYYY-MM>.jsonl` (if created)
   picks up one line per day the CLI ran — append-only, never rewritten.

## Related

- [The Morning Briefing's Open-Ticket Chart](BL-896-briefing-open-ticket-chart.md)
  — the sibling chart this one sits beside; shares the same cid/fail-open
  mechanism.
- [One briefing send, one backlog history walk: the shared lifecycle
  snapshot](BL-897-briefing-lifecycle-snapshot.md) — the data source this
  chart prefers when available.
