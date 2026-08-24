# Difficulty-aware coder seat routing (BL-1001)

## The gap

BL-983 delivers a stage-addressed parcel to whichever seat is idle —
difficulty-blind by design. With two coder seats that are not equivalent,
that landed hard work on the cheap seat and bounced it: a false economy.

## What changed

Claim filtering in `ready_for_next_task.bb` uses pure
`seat_difficulty_lib.bb`:

1. Ticket difficulty = existing `mutation_cost` (`low` / `medium` / `high`).
2. Each seat declares a tier on its pack `window` line: `--seat-tier easy|hard`.
3. Filter eligible seats by tier, then keep BL-983 idle-first among them.
4. Prefer the least-capable idle eligible seat when several can take the ticket
   (`:defer-better-fit`).

| Tier | Accepts |
| --- | --- |
| `easy` | `low` only |
| `hard` | `low`, `medium`, `high` |

Asymmetric spill:

- Above-tier never lands on a seat, however idle it is — the ticket waits.
- Easy work **may** spill up to a hard-tier seat when the easy seat is busy.

On a stage that has **any** declared `--seat-tier`, undeclared seats of that
stage do not claim (no inferred open). Stages with no declared tiers stay
BL-983-identical.

## Operator note

Declare tiers next to the model on the pack window line, e.g.:

```text
window coder … --seat-tier hard …
window coder@sonnet2 … --seat-tier easy …
```

Exchanging the two `--seat-tier` values exchanges routing with no code change.
Nothing infers tier from seat name or model string.

`full-forge.conf` currently declares `--seat-tier hard` on `coder`. A second
easy-only seat is restored the same way when host load allows — the filter is
already live.

Orthogonal to BL-1004 (rework affinity): this steers **fresh** claims.

Acceptance:
`specs/features/BL-1001-difficulty-aware-coder-seat-routing.feature`

Related: Spec BL-983 multi-seat claim; `docs/how-to/BL-1004-cross-seat-rework-claim-deferral.md`.
