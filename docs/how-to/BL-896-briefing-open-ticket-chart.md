# The Morning Briefing's Open-Ticket Chart

## What it is

The morning briefing email carries a second rendered chart alongside the
existing architecture diagrams: a per-day line of how many backlog tickets
are open (`active/` + `paused/` + `hold/`), with filed and closed rates.
It renders as SVG, is converted to a `cid`-attached PNG the same way the
architecture diagrams already are, and appears in its own section with its
own heading.

**The heading reads "Backlog burndown — open tickets remaining."** The chart
plots the same open-count-over-time family of data a burndown chart would.
[BL-659's 2026-07-26 ruling](../reference/Specification.MD) banned burndown
*charts* for the PWA/milestone-dashboard surface, and ratified the
open-count/net-flow view as their replacement there — but the 2026-08-16
08:20 CEST human ruling on this ticket explicitly keeps the word "burndown"
on this email chart's heading, overriding an earlier draft that had renamed
it away. The ban itself is unchanged and still applies to the
PWA/milestone-dashboard surface; it does not reach this email chart. See
`backlog/answers-archive/ANSWER-BL-896-land-burndown-chart.md` for the
ruling. If you're looking for the chart in code, its module is still named
`notDoneBurndown.ts` / `render-briefing-burndown.ts`.

## Where the data comes from

`computeNotDoneBurndownSeries` (`extension/src/metrics/notDoneBurndown.ts`)
derives each day's point from `deriveTicketLifecycles`
([shared once per send via the lifecycle
snapshot](BL-897-briefing-lifecycle-snapshot.md)), then reconciles only
*today's* point against a live disk count of `active/`+`paused/`+`hold/`
files — every earlier day keeps the lifecycle-derived estimate, since past
disk state can't be reconstructed. The reconciliation exists because
`deriveTicketLifecycles` undercounts: a ticket retired by deleting its YAML
file (rather than moving it to `done/`) never gets a close event, so it
reads as open forever. That's a gap in the shared adapter, not something
this chart alone fixed — every other consumer of `deriveTicketLifecycles`
still inherits it for days other than today.

Rendering (`notDoneBurndownChart.ts`) is a separate module from the series
computation (`notDoneBurndown.ts`) — the split exists purely to keep each
file under the mutation-site-count threshold, not for any behavioral
reason.

## The projected ETA (BL-910)

The chart carries a projection caption beside the counts it is derived from.
It answers one of two ways, and never a third:

**When the backlog is genuinely shrinking:**

```
Projected clear (all open tickets): 2026-09-14 · ~25d at net burn 0.8/d
```

**When it is not** — net burn zero or negative:

```
no ETA — backlog still growing (net burn -0.3/d, all open tickets)
```

Never a date, never "never", never a fabricated infinity or a placeholder.
That is the human's one hard condition on this feature and it is enforced as
an invariant, not as a branch in one renderer.

### How to check it by hand

Net burn is the close rate minus the mint rate, and both are already printed
in the subtitle. Divide the open count by net burn and you get the days:

    etaDays = openN / (closePerDay - mintPerDay)

The projection is computed from exactly those printed numbers, rounded to the
one decimal the subtitle shows *before* the division — so a reader dividing
what they see on the chart gets the same answer the chart gives. That is
deliberate: the division is kept in integer tenths rather than dividing by a
reconstructed float, because the float form reintroduces rounding dust that
`Math.ceil` turns into a whole extra day (at 21 open and 0.7/d net burn,
`21 / 0.7` evaluates to `30.000000000000004` and ceils to 31, while the
printed numbers give 30). Fractional days always round up.

### Scope — this is not the milestone forecast

The caption names "all open tickets" on the chart itself. This projection is
repo-wide open count; it is **not** BL-228's milestone p50/p85 delivery
forecast, which stays where it is and is not reused here. The human's
instruction was "do not silently introduce a second disagreeing ETA" — that
is met by naming the scope on the chart, not by hiding either number.

### Why a caption and not a dashed line

A projection drawn on the same axes as the real series can be misread as
measured data. One number in the subtitle, beside the counts it comes from,
is what "read at a glance" asked for. A dashed projection line remains a
later, separate call.

## Fail-open independence from the architecture diagrams

The two diagram sources — architecture diagrams and this chart — are each
wrapped in their own `try`/`catch` in `handoffd.bb`
(`diagram-section-from-sources` in `briefing_email_lib.bb`) before being
concatenated into one email section. One source throwing, returns `nil`, or
renders nothing cannot suppress the other, and cannot suppress the send
itself:

- Architecture diagrams fail, chart succeeds → email still carries the
  chart, with a note that the architecture diagrams are unavailable.
- Chart fails, architecture diagrams succeed → email still carries the
  diagrams, with a note that the chart is unavailable.
- Both fail → email still sends, with a plaintext note and no attachments —
  never a failed send.
- The backlog has no history yet (empty window) → the chart section is
  omitted and the send proceeds normally.

## Verifying

1. Trigger a briefing send and open the email. Read the chart's heading and
   subtitle — confirm they describe open tickets over a window, never a
   target or a remaining-to-zero. The chart *does* carry a projected
   completion date since BL-910, but only as the scoped projection caption
   described above: confirm it names "all open tickets" and that no
   milestone p50/p85 figure appears beside it.
2. On the day the email was sent, count `backlog/active/*.yaml` +
   `backlog/paused/*.yaml` + `backlog/hold/*.yaml` by hand and confirm it
   equals the chart's last point.
3. Rename `docs/diagrams/architecture.mmd` aside and send — confirm the
   email still carries the open-ticket chart. Restore it, then rename
   `extension/out/tools/render-briefing-burndown.js` aside and send —
   confirm the architecture diagrams still arrive. Restore both.
4. With both renders broken, confirm the email still sends (plaintext note,
   no attachments) rather than failing or crashing `handoffd`'s log.
5. Point the CLI at a checkout with no `backlog/` history — confirm the
   chart section is omitted and the send still proceeds.

## Related

- [One briefing send, one backlog history walk: the shared lifecycle
  snapshot](BL-897-briefing-lifecycle-snapshot.md) — the data source this
  chart reads from.
