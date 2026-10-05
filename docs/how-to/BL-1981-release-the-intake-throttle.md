# Release the intake throttle after a signal clears (BL-1981)

Article 3.5's 2026-10-05 amendment: a throttle signal clearing no longer
restores the configured `active_backlog_max_depth` cap by itself. Before
this ticket, `effective_backlog_depth_cli.bb` printed
`min(configured, recommended)`, so the cap sprang back to configured the
moment the signal that lowered it cleared — the change log shows this
happening on its own, twice: 2026-09-25 12:39Z "the red count cleared -
restoring the configured cap", 2026-10-01 22:49Z "an unowned red cleared -
restoring the configured cap". The human's own words: "The swarm is
working ok, it is not safe to resume churning at full throttle [just
because signals look normal again]." Now the cap holds at the **lowest**
value a throttle episode reached until a human explicitly answers it.

## The episode state machine

`extension/src/tools/emit-throttle-recommendation.ts` tracks a **throttle
episode** inside `.swarmforge/coordinator/throttle-recommendation.json`
(no new state file — the existing recommendation file gains `heldCap` and
`episode` fields):

- **Opens** on the first run whose own fresh recommendation lowers the
  cap. A recommendation merely left on disk by an earlier run never opens
  one.
- **While open with no recorded answer**, the effective cap is the
  **lowest** cap the episode has reached across every tick — including
  after the signal that opened it clears. A signal that eases from severe
  (cap 0) to degraded (cap 1) and back stays held at 0.
- **Reports itself as "awaiting release"** once its signal has cleared and
  no answer is recorded yet, naming the signal that opened it, when it
  cleared, and the configured cap a release would restore. The coordinator
  (and, once BL-1982 lands, the human-facing ask) reads this field. The
  raw `recommendedCap` is still withdrawn and logged as cleared exactly as
  before (BL-1429's own contract, unchanged) — the hold is a second,
  separate floor, never a rewrite of the honest signal.
- **Closes** once a `--release` answer has been recorded **and** the raw
  recommendation has actually been withdrawn.

`swarmforge/scripts/backlog_depth_lib.bb`'s `effective-max-depth` folds in
a third term: `min(configured, recommended, held)` — `read-held-cap`
reads the `heldCap` field the TS side already computed and persisted;
Babashka never re-derives the episode state machine itself.

## Recording a human's answer

```bash
node extension/out/tools/release-intake-throttle.js <project-root> --by <who> --release [--reason <text>]
node extension/out/tools/release-intake-throttle.js <project-root> --by <who> --keep <N> [--reason <text>]
```

- **`--release`**: ends the hold. The cap goes back to following
  `min(configured, the live recommendation)`; the episode itself closes
  once that recommendation is withdrawn.
- **`--keep <N>`**: holds the cap at `N` (still bounded by the same
  never-raise `min`) and stops the episode reading as "awaiting release",
  so nothing asks again — but the episode stays open; it is not the same
  as a release.
- Refuses (exit non-zero, nothing written) when no episode is open — there
  is nothing for the answer to apply to.
- Every answer is logged to the throttle change log, naming who gave it.
- An answer recorded for one episode **never** applies to a later one: a
  fresh episode that opens after this one closes starts with no answer of
  its own, and must be asked about again.

This is the same interface `coordinator.prompt` calls by hand today, and
that BL-1982 (asking the human directly, with no coordinator seat) will
call once it lands.

## Reading the state

```bash
bb swarmforge/scripts/effective_backlog_depth_cli.bb <project-root>
cat .swarmforge/coordinator/throttle-recommendation.json
```

The CLI's printed number is always the true ceiling in force — configured,
the live recommendation, and any held cap, all folded through the same
never-raise `min`. The JSON file is the one record of whether an episode
is open, awaiting release, or already answered.

## Related

- [Article 3.5 / the circuit-breaker amendment](../../swarmforge/constitution/articles/reference/circuit-breaker-human-release-amendment-2026-10-05.md)
- [Raise active backlog depth on host headroom](BL-1128-raise-active-cap-on-host-headroom.md) — the configured cap this hold floors beneath; unaffected by this ticket.

Acceptance:
`specs/features/BL-1981-a-cleared-throttle-signal-holds-the-cap-until-a-human-releases-it.feature`,
`specs/features/BL-432-auto-tune-intake-throttle.feature`,
`specs/features/BL-1429-standing-reds-throttle-intake.feature`.
