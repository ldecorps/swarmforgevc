# Coordinator pattern note ("cleaner fixes a bounce, never re-forwards") - specifier adjudication (2026-09-16 17:55Z)

Inbound: `00_20260916T174130Z_008844_from_coordinator_to_specifier`,
"Pattern x2 today: cleaner fixes a bounce, never re-forwards (1595,1547)".

## Trace (read from mailboxes and git, not guessed)

- Architect bounces: BL-1595 at 16:37Z (D1: cleaner evidence misfiled under
  extension/backlog/evidence), BL-1547 at 16:40Z (same defect). Each landed
  in the cleaner's inbox as TWO files in one batch: the bounce (git_handoff,
  `to: cleaner`) and a `non-forwarding: true` twin with the same task, commit
  and sender, ids adjacent (002087/002089; 002090/002092). Batches
  `batch_20260916T163832Z_000001` and `batch_20260916T165041Z_000001`.
- Cleaner fixed both: 37a06e7417 (16:49Z) and 6cd22a3ec0 (16:50Z),
  "relocate cleaner evidence to backlog/evidence". No forward followed.
- Coordinator chased: 17:36:39Z ("BL-1595: your fix 37a06e7417 never
  forwarded to architect - send it") and 17:41:22Z (BL-1547). Forwards
  went at 17:37:11Z (`000752` to architect, `000753` non-forwarding to
  coder) and 17:41:46Z (`000756`, `000757`). Fifty minutes each.
- Why the twin exists: `swarmforge/packs/full-forge.conf:269-270` declares
  cleaner `back-one`, architect `back-all`; `reverse_hop_lib.bb`
  `reverse-recipients` (line 133) returns every earlier role for back-all
  without subtracting the forward's recipients; `swarm_handoff.bb` writes
  a non-forwarding copy to each. A bounce to the cleaner therefore also
  sends the cleaner a merge-only copy of itself.
- Why the fix did not forward: `swarm_handoff.bb` `inbound-non-forwarding?`
  (line 903, batch-aware, BL-1302/BL-1313) refuses every git_handoff while
  any in_process file carries the marker; the twin sits in the same batch
  as the bounce, so the cleaner's re-forward is refused until the batch
  is completed - and the cleaner did not retry after completing it. The
  cleaner's prompt said a non-forwarding inbound is merge-only (true) and
  said nothing about a twin of a bounce it is actively fixing.

## Ruling

Mechanism defect, with a prompt gap on top. Minted **BL-1605** (high,
swarm-reliability): the reverse set is the declared earlier roles minus
the forward's recipients; forward hops and the coordinator exclusion
unchanged; the send gate unchanged. Interim rule appended to
`cleaner.prompt` the same commit: a fixed bounce is finished only when
the forward has queued; a refusal during the batch means complete the
batch and re-send the same draft at once.

## Recorded, not ticketed

- BL-1536 fixed the stamp for the terminal role's bounces; this is the
  sibling defect for reverse-copy synthesis. The reverse-hop feature
  (BL-1299) never had a scenario for "forward recipient is itself an
  earlier role".
- The coordinator's dropped-parcel chase found both within an hour: the
  safety net worked; the cost was two chases and one specifier pass.
