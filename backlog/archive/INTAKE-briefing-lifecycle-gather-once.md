# Raw intake — Briefing email must not re-walk git history per enrichment (share one lifecycle pass)

Status: **new intake, not minted.** Capture only (human via Cursor
2026-08-15 ~09:22 CEST). Specifier: mint and spec. Orthogonal follow-on
to `INTAKE-briefing-not-done-burndown.md` (feature already committed as
hotfix `14724edae` pending certification) — this ticket is the
**performance / data-gathering** fix, not the chart itself.

## Why this is in front of you

Observed live 2026-08-15 while today's briefing email was still unsent:
4-core host load stayed ~4× saturated for tens of minutes; CPUs were
dominated by concurrent briefing enrichment work — `render-briefing-diagrams.js`,
repeated `git log … -- backlog`, and (separately) VS Code
`git log --follow` per YAML. Measured alone:

| Job | Wall time (quiet host) |
|-----|------------------------|
| `runGitLog(backlog)` → `deriveTicketLifecycles` | ~7 s |
| `render-briefing-burndown.js` (includes that walk + PNG) | ~10 s |
| `render-briefing-diagrams.js` | ~12 s |

The burndown chart itself is fine at ~10 s. The problem is the morning
briefing sweep running **several independent full-history walks** of the
same `backlog/` pathspec (burndown CLI, cost-health sidecar, digest /
other metrics) plus heavy diagram rasterization, under memory pressure,
on the handoffd cadence — so a send that should be tens of seconds
stretches into a multi-minute host spike and can leave the email unsent.

Human ask: **spec a change so the necessary lifecycle data is gathered
once (or reused), not re-derived from scratch by every briefing section.**

## Goal

1. Mint a defect / enhancement ticket (next free id after the burndown
   intake — expected **BL-897** if burndown took BL-896) for briefing
   email data gathering.
2. Spec that the daily briefing path obtains ticket lifecycle events
   **at most once per send** (or cheaper still: reuse an already-written
   same-day artifact) and feeds burndown / cost-health / digest / any
   other lifecycle consumer from that shared snapshot.
3. Acceptance must prove: a briefing send does not shell N independent
   `git log … -- backlog` walks for N lifecycle consumers; host cost of
   adding the burndown chart is near zero beyond its SVG/PNG step when
   lifecycles are already in hand.

## Preferred directions (specifier picks; do not invent a fourth daemon)

Any of these (or a combination) are acceptable — pick the smallest that
holds the invariant:

1. **Reuse same-day cost-health sidecar** — `emit-cost-health-sidecar`
   already runs `deriveTicketLifecycles(runGitLog(backlog))` into
   `docs/briefings/<date>.json`. Burndown (and peers) consume that
   instead of calling `runGitLog` again.
2. **One shared lifecycle snapshot per briefing sweep** — handoffd (or
   `briefing_email_lib`) gathers once; adapters receive the array /
   tempfile / JSON, never each re-shell.
3. **Persist / append a daily remaining-open series** — so a send only
   needs today's delta, not full history every morning.

Out of scope unless you deliberately widen: rewriting architecture
diagram rendering (also expensive ~12 s, separate concern); silencing
VS Code's per-file `git log --follow` metrics path (observed competitor,
not the briefing pipeline).

## Locked human decisions

1. Burndown chart **stays** on the morning briefing (see sibling intake /
   `14724edae`); this ticket is not "remove burndown," it is "stop
   paying for full-history git N times per send."
2. Specifier decides slice shape and which preferred direction above;
   do not leave the multi-walk behavior as the permanent design.
3. Prefer reusing existing briefing / sidecar machinery over a new
   daemon or a new metrics store.

## Related

- Sibling: `backlog/INTAKE-briefing-not-done-burndown.md` (feature + ban
  reconciliation).
- Hotfix already on local main: `14724edae` (Hotfix-Certification:
  pending) — `notDoneBurndown.ts`, `render-briefing-burndown.ts`,
  `handoffd.bb` `briefing-burndown-json`, `briefing_email_lib.bb`.
- Existing single walk: `gitHistoryAdapter.runGitLog` +
  `deriveTicketLifecycles`; cost-health sidecar already calls both.

---

**Dispositioned 2026-08-15 (specifier).** Specced as **BL-897**
(`backlog/paused/BL-897-briefing-gathers-lifecycles-once.yaml`). Preferred
direction 2 chosen (sweep gathers once, consumers take an optional snapshot
path); reasoning recorded in the ticket.
