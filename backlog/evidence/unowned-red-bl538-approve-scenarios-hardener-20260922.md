# BL-538 pager: 3/8 acceptance scenarios red on main - hardener sighting, 2026-09-22

Sighted while spot-checking the BL-1685 (bridgeServer lazy-require)
handlers' own feature suites. Not caused by BL-1685: reproduced against
`main` directly (`b5c1b97a12` is on `main`), and main's own
`bl538ConsolePausedTicketPagerSteps.js` has no handler matching
`Given a paused ticket with human_approval pending is shown on the pager`
either.

`node specs/pipeline/cli.js specs/features/BL-538-console-paused-ticket-pager.feature`:
- "Approve is shown only for paused tickets awaiting human approval":
  no step handler matched the Given above.
- "confirmed Approve records human_approval without promoting": same.
- "confirmed Expedite sets priority 0, jumps the queue, and advances":
  `Expected values to be strictly equal: 409 !== 200` on the confirm step.

5/8 scenarios pass. No open ticket found for this
(`grep -rl "human_approval pending is shown on the pager" backlog/active
backlog/paused` empty).

By hardender.
