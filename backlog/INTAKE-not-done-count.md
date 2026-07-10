# INTAKE: show the count of "not done" tickets in the PWA and the daily briefing

Source: operator direction 2026-07-10 (via coordinator): "add to the phone app +
daily briefing the number of tickets 'not done'."

## Want (observable)
Both surfaces show a single count: how many tickets are NOT done.
  - PWA (phone app): the not-done count is visible on the backlog dashboard.
  - Daily briefing (morning email): the not-done count appears as a line/metric.

## "Not done" — interpretation (specifier confirm)
Count of tickets whose lifecycle state is NOT `done` — i.e. still open:
backlog + `backlog/active/` + `backlog/paused/`, everything except
`backlog/done/`. If a finer split is cheap (e.g. active vs paused vs backlog),
that is a nice-to-have, but the primary ask is the single "not done" total.

## Fit / reuse (verify live paths before naming files)
- PWA reads the committed backlog projection (backlog.json, BL-097 dashboard);
  the count is a pure derivation over tickets already in that data — a
  presentation-only addition, NO new store.
- The daily briefing already composes delivery metrics (BL-099); add the
  not-done count as one more composed metric from the same backlog-derived
  source. Do not re-derive backlog state a second way — reuse the existing
  reader (backlogReader.ts / the briefing's metric source).

## Constraints
- PRESENTATION / COMPOSITION ONLY: derive the count from the existing
  backlog projection; add no authoritative store (BL-252 projection boundary).
- SINGLE SOURCE: PWA and briefing derive the count the same way (one shared
  count function), so the two surfaces never disagree.
- TESTABLE host-side: the count function (tickets -> not-done total) is a pure,
  fixtured unit; assert the number, not a live repo scan.
- LOCALIZATION (BL-229/230): any new PWA/briefing label goes through the
  existing string plumbing (pwa/locales.js); graceful empty/zero state.

## Delivery
Small, buildable now (reuses BL-097 dashboard + BL-099 briefing). Priority:
operator to set; suggest normal. NOTE (coordinator orthogonality): touches
pwa/app.js (BL-251/257/261 lane) and the briefing compose path
(BL-256/258/260 lane) — serialize at build time with those; not a scoping concern.
