# Bedtime vs. lights-out: which stop verb to run

## Background

`./stop-swarm.sh` stops the whole stack — including the Telegram front desk
(the Let's Talk bridge) and the remote tunnels that publish it. That's
correct for an actual lights-out (the human is travelling, the host is going
off), but running it as an ordinary end-of-day step takes the phone's origin
down with everything else: Bubble shows a Cloudflare 530 / DNS error, which
reads as "the app is broken" rather than "the pack went to sleep."

`./finish-shift` is the bedtime verb: it stops the token-burning pieces and
leaves the phone path up.

## The keep-vs-kill table

Both verbs read the same table
(`swarmforge/scripts/lifecycle_matrix.sh`), so there is one answer to
"what does bedtime keep up?" — not two implementations that could drift.

| component | `./finish-shift` (bedtime) | `./stop-swarm.sh` (lights-out) |
|---|---|---|
| swarm agent sessions | stop | stop |
| handoffd | stop | stop |
| babysitterd | stop | stop |
| operator runtime | stop | stop |
| onboarder | stop | stop |
| Telegram front desk (bridge + bot) | **keep** | stop |
| remote tunnels | **keep** | stop |

Babysitterd is stopped by bedtime because it is a supervised respawn loop —
left running, it would relaunch the very agent seats bedtime just stopped
(the ticket's second invariant: nothing bedtime leaves running can revive a
stopped seat).

Before it stops anything, `./finish-shift` also runs the
[closing-ceremony lean pass](../reference/BL-820-closing-ceremony-lean-pass.md)
(BL-820) while the pipeline is still up — folding the shift's lifecycle
ledger into a packet for the specifier. A missing compile or a non-zero exit
there is a loud skip, logged and continued past — it never blocks bedtime.

## Usage

```sh
# Bedtime: stop the pack, keep the phone path up
./finish-shift

# Lights-out: stop everything, including the phone path
./stop-swarm.sh
```

Both accept an optional target path (defaults to the repo root):

```sh
./finish-shift /path/to/target
```

Both are idempotent — safe to run against an already-stopped stack, and
safe to run finish-shift more than once in a row.

## Verification

`./finish-shift` refuses to report success while:
- a component it should have stopped (babysitterd, operator runtime,
  onboarder, or the pipeline) still shows a live process, **or**
- a component it should have left running (front desk, tunnels) was up
  before the run and is no longer running after.

The second half is deliberate: an already-stopped swarm's kept components
stay "unchanged" (still down), not forced up — bedtime never starts
anything that wasn't already running.

To fully stop the phone path too, run `./stop-swarm.sh` afterward — it
still tears down the front desk and tunnels and reports the same
survivor-scan-verified clean slate it always has.
