# Reduce frequent QA push-race / tip-purity rematch storms (BL-1144)

Rematch recovery (BL-1130 / BL-1131 / BL-1138 / BL-1141) already lands residual
races without paging a human. The remaining tax is **frequency**: concurrent
land/close publishers advance `origin/main` while a long QA gate holds a tip
on a stale base → tip-purity bounce cascades.

## Controls (both required)

1. **Publish-time tip rematch is authoritative**  
   Gate-time purity is advisory. Immediately before the land push, fetch and
   rematch so the tip contains current `origin/main`. Residual races retry
   within `publish-rematch-max-attempts` (2), then **wait on the land lock** —
   never an unbounded mid-gate rematch loop.

2. **Serialize land/close publishers**  
   Directory lock: `.swarmforge/land-main.publish.lock`. A second publisher
   rematches **once** at the lock edge, then waits. Peer-held lock → wait,
   do not bounce.

## Operator / QA discipline

Prefer:

```bash
swarmforge/scripts/land_main_publish.sh <root> --acquire-lock
# rematch tip-pure onto origin/main if decide-only says :rematch-then-push
swarmforge/scripts/land_main_publish.sh <root> --decide-only
git push origin HEAD:main   # never force-push; tip must contain origin/main
swarmforge/scripts/land_main_publish.sh <root> --release-lock
```

Policy: `master_main_reconcile_lib.bb` (`publish-time-purity-action`,
`land-close-publisher-admission`, `contention-publish-next`). Tip purity
remains mandatory; residual recovery stays rematch lander/bookkeeping.

## `--decide-only` now also refuses an entangled tip (BL-1309)

Tip purity (above) answers "is this push fast-forwardable" — it never asked
WHOSE work the tip carries. `main`'s first-parent chain IS the
`swarmforge-QA` branch, so a plain push of the branch tip ships everything
ever merged into it, including a ticket QA explicitly held for a human
ruling. That happened three times in two days (BL-1300, BL-1307, BL-1295)
before this ticket, each caught only by a specifier reading git history
after the fact — the one landing step QA cannot skip never asked.

`--decide-only` now consults BL-1241/BL-1308/BL-1354's finished
`entangled-siblings` detector before it prints any decision. If the tip
carries an unlanded sibling's content — through any route (a plain commit,
a second-parent merge, or a rematch) — it prints, **instead of** the
ordinary purity decision:

```
ENTANGLED_SIBLING_BLOCK
entangled-sibling: <ticket-id> ...
(one such line per unlanded sibling)
<a line naming the remedy: BL-1241's tip-pure replay, land_step_cli.bb>
```

and exits **3** (`2` stays the pre-existing usage error, `0` the ordinary
decision). The `DECISION` value is computed and held before this check
runs, so a refusal never has stale push advice already on stdout ahead of
it, and the land lock is never left held on a refusal.

**The ruling shipped here is option 2, as REVISED by BL-1375 (2026-09-04) —
refuse only a sibling that is WITHHELD, awaiting approval, or unreadable; an
APPROVED unlanded sibling rides.** Option 1 (refuse every entangled tip,
unconditionally) was the ruling first given and is what this guard shipped
until now — but it was never landed, and within hours of running for real it
deadlocked the land queue: four APPROVED tickets sharing one path each
refused on the others, and none could go first, since an entangled tip is
the normal state of a long-lived role branch. The narrowing is read through
`land_step_lib.bb`'s `blocking-siblings` — the same predicate `land-plan`
already decides on — so the mandatory `--decide-only` step and the hand-run
`land_step_cli.bb` can never disagree about one tip. Each blocked sibling's
line now names its state and reason:

```
entangled-sibling: <ticket-id> (withheld) <reason>
entangled-sibling: <ticket-id> (awaiting-approval) <reason>
entangled-sibling: <ticket-id> (unreadable) <reason>
```

An unreadable approval state still blocks — absence never buys a ride
(BL-1375 invariant 1). The remedy is unchanged: run `land_step_cli.bb <task>
<commit>` (see
[BL-1241](BL-1241-entangled-tip-at-the-land-step-has-a-reachable-remedy.md))
to build the tip-pure replay, land that instead. QA already performs this
by hand; the check now tells QA to rather than expecting it to remember.

**Fails open, deliberately, on anything it cannot read** — no tip SHA, no
`land_step_lib.bb` on disk, a tip whose subject names no ticket, an
unreadable range against `origin/main`, or a detector that errors: the
ordinary decision prints and no marker appears. Only a POSITIVE finding
ever refuses (same posture as BL-806/BL-1293/BL-1307's tip-purity checks) —
a land step that refuses because it *couldn't run* the detector would be a
swarm-wide land outage.

Measured cost: ~12x slower per `--decide-only` call (1.1s → 13.7s on a real
tip), from `entangled-siblings`' per-candidate-commit `git log` calls —
inherent to the detector, not this ticket's wiring; recorded as a known,
accepted cost of the ruling, not a defect. A land happens a few times an
hour.

## Related

- [BL-1131 rematch-then-FF](BL-1131-ticket-land-without-operator-absorb-merge.md)
- [BL-1130 clean-refuse absorb](BL-1130-land-on-main-without-external-conflict-resolution.md)
- [BL-1241 entangled tip has a reachable remedy](BL-1241-entangled-tip-at-the-land-step-has-a-reachable-remedy.md) — the detector this ticket wires in, and the tip-pure replay remedy
