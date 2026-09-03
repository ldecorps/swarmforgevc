# BL-1335 — documenter pass, 2026-09-03

Merged hardener commit `294a1f0766` (merge commit `e61155ff1a` — one
additive conflict in `specs/pipeline/steps/index.js`, both sides adding a
different `require(...)` line; resolved by keeping both).

## Doc review

- Diff scoped to `swarmforge/scripts/exhaustion_failover_promotion_lib.bb`
  (new) and `swarmforge/scripts/handoffd.bb` (new call site); no
  extension-side TypeScript, no new HTTP route, no new UI. Cleaner/architect/
  hardener evidence confirms no further diff beyond the coder's.
- No new extension command or setting — swarm-internal daemon behavior.
- Diagram check: `architecture.mmd`'s change-trigger is the extension
  host/webview boundary, the tmux substrate relationship, or the
  `.swarmforge/` state layout. This ticket writes into an existing file
  (`provider-outages.jsonl`) BL-669's consumer already reads — no new
  state-layout element, no boundary change. No diagram edit required.
- `docs/how-to/BL-669-outage-driven-seat-failover-via-steward.md` was stale
  in two ways this ticket makes concrete: (1) it described the failover
  record as something that "stays open" with no mention of how it opens,
  which read as manual-only now that an automated path exists; (2) its
  opening sentence attributed provider outage records to BL-650, a
  misattribution BL-1335's own notes flag and correct (BL-650 is the
  flow-watchdog wall-clock ticket; BL-840 is the real producer). Both fixed
  in the same commit as the new section, since the new section is built on
  getting that attribution right.

## Action taken

- Added a dated entry to `docs/reference/Specification.MD` (commit
  `b761aa9974`) covering: the two-file gap this closes, the three-way
  classification (unambiguous/suspected/none) and its fail-closed default,
  the shared record shape and idempotence guarantee, and the live-tick
  wiring anchor. `**Last Updated**` bumped in the same commit.
- Added an "Automated promotion (BL-1335)" section to the BL-669 how-to,
  corrected its BL-650→BL-840 misattribution, and added the BL-1335
  acceptance feature + `provider-outages.jsonl` cross-links under Related
  (commit `ea1d844a6e`, untagged subject per the task-scope gate's rule for
  editing a file basename-owned by a different, already-shipped ticket —
  BL-1192).

## Verdict

No documenter-domain defect found. Forwarding to QA.
