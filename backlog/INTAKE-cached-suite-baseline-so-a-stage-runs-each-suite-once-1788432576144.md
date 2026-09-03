# Intake: cache the suite baseline per base commit so a stage runs each suite ONCE, not twice

Filed by the Operator (2026-09-03, human-directed via Claude Code) from the
operator's question "why did BL-1375's coder pass take over an hour?". Part of
the repeatable-agentic-effort sweep (BL-667 inventory; siblings BL-1348/BL-1349
speed the suite itself, BL-1360/BL-1363 remove hand-made ceremony).

## Measured (BL-1375 coder pass, 10:38-11:41, evidence BL-1375-coder-20260903.md)

The coder ran `npm run test:properties` (143 s) and `npm test` (~30 s) TWICE
each - once at the parcel's base and once with the parcel - purely to write
the evidence sentence "identical failure set with and without this parcel".
That is the evidence rule working as designed (pre-existing reds must be shown
to be pre-existing, BL-1063), but it is ~3 min of pure re-computation of a
fact that does not change: the failure set of a given suite at a given base
commit. Every stage of every parcel pays it again (coder, cleaner, hardener,
QA each re-derive the same baseline).

## Ask (direction, not mandate)

1. Record, once per base commit, each suite's failure set (file list + counts,
   keyed by suite name + base sha + suite-config hash) in a store the roles
   already read - e.g. next to `extension/.test-durations.jsonl` or under
   `.swarmforge/` - written by whichever stage first runs the suite at that
   base (or by the land step at publish time, when main moves).
2. A stage that finds a fresh baseline for its base sha runs the suite ONCE
   (with the parcel) and diffs against the recorded set; only a mismatch
   (new red, or a red that vanished) forces the second run.
3. Fail closed: no baseline, stale config hash, or unreadable record → today's
   behaviour (run both). A cached baseline is never evidence that a NEW red is
   pre-existing - the diff must name it.
4. Keep BL-1175's standing allowlist as the second input it already is; this
   caches the observed set, it does not replace the allowlist.

Expected: -2.5 to -3 min per stage per parcel at today's suite speed; still
-1 min after BL-1348/1349 land. Roles' evidence sentence becomes "baseline
<sha> recorded by <stage>: N reds; with parcel: N reds, same set".

Not in scope: changing what counts as a pre-existing red (BL-1063), or the
suite's own speed (BL-1348/BL-1349).

By operator.
