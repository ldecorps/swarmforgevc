# Intake: expedite's park-for-the-expedition should self-reverse when the expedition finishes

Filed by QA (2026-09-03, human-directed via Claude Code, direct instruction in
this session — not via Telegram). Human's words, verbatim:

> when the swarm holds ticket to make way for an expedition, it shoud unhold
> the tickets as part of finishing the expedition. so that it reinstate the
> original state. (minus the one ticket that was expedited)

## The concrete instance that prompted it

While landing the stranded `expedite/BL-1375` branch this session (evidence:
`backlog/evidence/BL-1375-qa-land-20260903.md`), the expedite run's own park
step (`swarmforge/runtime/expedite-BL-1375.log`) moved five tickets —
BL-1296, BL-1309, BL-1356, BL-1359, BL-1360 — from `backlog/active/` to
`backlog/hold/` to make room for the expedition. Checked on `origin/main`
right now: all five are still sitting in `backlog/hold/`, all still
`human_approval: approved`, `status: todo` — nothing ticket-specific is
holding any of them; they are only there because of the mechanical park.
BL-1375 (the ticket the park made room for) is now landed
(`fd506c0b09` on `origin/main`), so the reason for the park no longer exists,
and nothing in the swarm noticed or reversed it.

## Why this is structural, not a one-off miss

Article 3.1 defines `backlog/hold/` as **human-held** items: "Never
auto-promote from here; they sit until a human moves them back to
`paused/` or `active/`." The expedite driver parks into this same folder
(`swarmforge/scripts/expedite_lib.bb`'s park step; see
`docs/how-to/BL-567-…md`) for its own mechanical, temporary,
non-human reason — and nothing in the driver's teardown, closing summary, or
`OUTSTANDING` block un-parks them again. Because the folder's contract is
"only a human moves these," a mechanical park that lands in it has no
self-healing path: it silently becomes indistinguishable from a genuine
human hold, and sits until a human happens to notice (as almost happened
here — see the attached coordinator screenshot reasoning about BL-1296 as
a side note, "not requiring action", without connecting it back to BL-1375
now being done).

This is the same family as, but distinct from, the two defects already
ticketed from this same expedite run:

- **BL-1376** — the run's `OUTSTANDING` block never names the unlanded
  branch itself.
- **BL-1378** — the close-guard precondition is structurally unsatisfiable
  for an expedite-closed ticket.

Neither of those covers the park side effect. This intake is specifically:
**when an expedite run finishes (or when the branch it produced is
landed), every ticket it parked for that expedition should be restored to
its prior folder** — reinstating the state that existed before the
expedition started, minus the one ticket that was expedited (which has its
own, separate disposition: landed, still active pending its own further
pipeline stages, etc.).

## Not in scope of this intake

- Whether the current five tickets should be manually un-held right now as
  an immediate remediation — that's a judgment call for whoever adjudicates
  this (specifier/coordinator), not asserted here.
- The mechanism for "finishing the expedition" — teardown time vs. the
  eventual land time — is a design choice left to whoever specs the fix;
  landing is the only externally-observable "done" signal today (teardown
  already happens before landing, per BL-1376/BL-1378's own findings, so a
  teardown-time unhold would still race an unlanded branch).

Per Article 5.3, the human's sentence above must survive verbatim into
whatever ticket(s) this becomes.
