# Scheduled descent ladder proposes a cheaper notch (BL-1327)

## The gap

[BL-1317](BL-1317-adapt-tier-effort-from-outcome-signals.md) already climbs a
seat's effort on a bounce and can drop it one notch after a clean streak —
but only within a single ticket's completion, and it never touches the
seat's *model*. Nothing periodically asks "has this seat been guard-clean
long enough to try something cheaper — effort first, then model?" That
periodic question, and the human's 2026-09-02 direct ask to prioritize
cost-reduction ("downgrade a well-performing seat to the cheapest model that
still keeps its bounce guard clean"), is what this ticket answers.

**Slice 1 is proposal-only**, by that same 2026-09-02 ruling: the review
writes a durable proposal record for a human to apply by hand. There is no
apply verb anywhere in this code path — the governance boundary ("no
autonomous seat mutation") is enforced by the shape of the API, not by a
comment asking callers to behave. Guarded auto-apply, if wanted later, is a
separate, later-minted ticket.

## What runs, and when

`swarmforge/scripts/install_swarmforge_crons.sh` installs a daily cron line
(`swarmforge/scripts/install_descent_review_cron.sh`, default schedule `17 4
* * *`, override with `SWARMFORGE_DESCENT_REVIEW_SCHEDULE`) that runs:

```
bb swarmforge/scripts/descent_review_cli.bb review <project-root>
```

This reads each seat's ladder position from
`.swarmforge/descent-ladder/state.json` and its review config from
`.swarmforge/descent-ladder/config.json`, decides per seat, and writes the
result to `.swarmforge/descent-ladder/proposals.json` — `applied: false`
always, and the file itself says so (`"PROPOSAL ONLY - a human applies these
by hand (BL-1327 slice 1)"`).

To see the standing proposals without re-running the review:

```
bb swarmforge/scripts/descent_review_cli.bb list <project-root>
```

## The decision, per seat

The pure decision lives in `swarmforge/scripts/descent_ladder_lib.bb`
(`descent-decision`), and reuses BL-1317's own effort ladder
(`seat_difficulty_lib.bb`'s `adapt-effort-ladder`) rather than inventing a
second one — a seat is never walked onto a rung the climb half has never
heard of (BL-897).

1. **A guard trip proposes nothing this period.** Ladder state climbs back
   to the seat's last known-good notch immediately (`record-guard-trip`),
   discarding any partial clean-period progress — whatever the ruling on
   auto-apply, because this is ladder bookkeeping, not a seat mutation. With
   no known-good notch recorded, the seat just stays put.
2. **A clean streak below the configured threshold holds.** A descent needs
   the *whole* streak (`required_clean_periods`, default 3) at the current
   notch — one clean period never moves a seat, which is the asymmetry
   against BL-1317's one-signal climb that the epic asks for.
3. **Effort notches on the current model are exhausted before any model
   change.** While a lower effort rung exists for the current model, that
   rung is the proposal.
4. **Once effort is exhausted, the next cheaper model is proposed — always
   at HIGH effort, never at the bottom rung.** A smaller model may need
   *more* deliberation, so descending the model ladder and the effort ladder
   in the same notch would confound two changes in one step and could not be
   read.
5. **A price-window shift ([BL-1056](BL-1056-a-price-with-an-expiry-date.md))
   re-walks a terminal seat.** A seat parked at the bottom of both ladders is
   re-evaluated the next time its model's price validity window shifts,
   rather than staying frozen at a stale terminal notch forever.

## Reading a proposal

```
PROPOSE coder@seat2 -> medium on claude-sonnet-5 (guard-clean for 3 review periods at high on claude-sonnet-5 - try one effort notch lower before any model change)
HOLD coder -> clean streak 1/3 at the current notch
proposals written: .swarmforge/descent-ladder/proposals.json
```

Each `PROPOSE` line, and its matching entry in `proposals.json`, names the
seat, the candidate effort/model notch, where the seat is coming `from`, and
the reason. Nothing about running the review or reading its output changes a
live seat — applying a proposal (editing the pack conf's `window` line, same
mechanics as [BL-1320](BL-1320-add-or-remove-a-seat-of-a-bottleneck-stage.md))
is a deliberate, separate, human step.

## Not this ticket

- Auto-applying a proposal — a separate, later-minted ticket if wanted.
- BL-548's prompt-adapter calibration loop (a different, still-blocked
  evaluation concern this review does not run).
