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
   target, a remaining-to-zero, or a completion date.
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
