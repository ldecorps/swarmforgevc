# BL-1687 rode along in the BL-1692 branch, no cleaner/architect evidence - hardener sighting, 2026-09-22

The coder's BL-1692 branch (swarmforge-coder) carries BL-1687's own two
commits directly in its history, sequentially before BL-1692's own work:

- `5d3416820c` BL-1687: seventeen path.join/object-literal bridgeServer
  loaders move the require inside their step
- `af360d7c09` BL-1687: fix scenario 02's own census pattern -
  bridgeServer, not bridge/bridgeServer

`backlog/evidence/BL-1687-sequencing-adjudication-specifier-20260922.md`
records the coder holding `5d3416820c` on this branch, blocked on
BL-1685 landing, with the plan "the coder merges main ... and the
parcel forwards" once BL-1685 (now in `backlog/done/M8/`) lands.

That happened - but the SAME branch then continued with BL-1692's own
commit, and cleaner and architect processed the combined tip. Both
recorded evidence ONLY under BL-1692's name
(`BL-1692-cleaner-20260922.md`, `BL-1692-architect-20260922.md`); no
`BL-1687-cleaner-*` or `BL-1687-architect-*` evidence exists anywhere.
BL-1687 itself is still in `backlog/paused/`, never re-promoted.

I confirmed BL-1687's own work is functionally sound at this tip
(`node specs/pipeline/cli.js` on its feature: 17-18/18, one flake at
host load ~1x cores on a 400ms-budget scenario, clean on rerun; not a
regression), but I am not the cleaner or the architect, and forwarding
it under their names would be exactly what Article 2.6 and BL-506
("An Approval Authorizes Only Its Ticket's Work") warn against - I
cannot retroactively produce their per-role review.

## Disposition

Filed as a note (priority 00) to specifier and coordinator rather than
forwarded. My own hardening pass on BL-1692 proceeds and forwards
separately (this ticket's own scope is clean and disjoint from
BL-1687's files). Recommend: re-promote BL-1687 and route it through
cleaner then architect on this same commit (`af360d7c09` or later),
each filing its own evidence, before it reaches hardener.

By hardender.
