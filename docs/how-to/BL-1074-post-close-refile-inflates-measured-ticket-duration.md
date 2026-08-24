# Mean ticket time ends at close, not a later re-file (BL-1074)

## The gap

After BL-1066's single shared git walk, each closed ticket's duration still
ended at the **newest** arrival at its current `backlog/done/` path. A
post-close re-file (`done/` → `done/M8/` …) therefore inflated the number —
often by hours or days — with no UI hint. On a measured host that was ~38%
of closed tickets under milestone subdirectories.

The written Metrics Pane contract already said "active → done"; the walk
needed to match it.

## What changed

`lastCycleBoundsMs` in `extension/src/metrics/swarmMetrics.ts`:

1. Start from the newest arrival at today's done path.
2. Walk rename history through done→done re-files.
3. **Close** = the hop whose `fromPath` is under `backlog/active/` (or, for
   a copy-close that dead-ends on an Add, that Add after the re-file walk —
   never the later re-file tip).
4. **Activation** = arrival under active strictly **before** that close
   (so a reopen between close and re-file cannot steal the closed cycle).

Still one `git log` subprocess per computation (BL-1066 bound unchanged).

## Operator note

Mean ticket time on the panel / metrics CLI should drop after this lands if
the corpus had many milestone re-files; that is correction, not a slowdown
of the swarm. No new command or setting.

Acceptance:
`specs/features/BL-1074-post-close-refile-inflates-measured-ticket-duration.feature`
