# Raw intake — on a standing full-forge pack, `rotate_to_role` steals the specifier pane and boots it as coder

Status: new intake, not minted. Capture only (human via Cursor 2026-08-18
~22:52 CEST). Do **not** kill the live duplicate Coder by hand.

## Human ask (verbatim)

After a check found the specifier pane running as Coder, the human asked
why. Answer: full-forge has no rotation, but `rotate_to_role.sh` still
respawned `swarmforge-specifier` as `coder.sh`. Then:

> Let specifier know about this bug

## Observed (live, same evening, twice)

Pack is `full-forge`. `config rotation router` is **absent**.
`.swarmforge/swarm-identity` has `launch_pack	full-forge` and an empty
`rotation` field. Every pipeline role has its own tmux session.

`rotate_to_role.sh coder` still ran. `handoff_lib.bb` /
`mono-router-resident-session` treats the **first non-coordinator**
`roles.tsv` session as the sole resident. On this pack that row is
`swarmforge-specifier`, not `swarmforge-coder`. `rotate-resident-to!`
does `tmux respawn-pane -k -t swarmforge-specifier` with `coder.sh`.

Tonight:

1. Earlier (~20:26 CEST): specifier pane was already `coder.sh`
   (PID 38149) while `swarmforge-coder` held a second
   `--remote-control SwarmForge-Coder` (PID 12937). Specifier later
   got their hat back long enough to mint BL-928 / BL-930.
2. After BL-930 was specced and approved (commits 37d47c09b 22:22,
   566fceb08 22:25): specifier pane respawned again as coder
   (~22:27). Live at capture: pane pid **97604** running
   `.swarmforge/launch/coder.sh`, child **97895**
   `--remote-control SwarmForge-Coder`, cwd `.worktrees/coder`.
   Marker `.swarmforge/mono-router-active-role` = `coder`.
3. Standing coder pane **12927** / claude **12937** was left running.
   Two Coders, one remote-control name. Occupant of the stolen pane
   raised an identity-mismatch ask: session `swarmforge-specifier`,
   env `SWARMFORGE_ROLE=coder`, doing BL-930 in the coder worktree.
4. QA note `50_20260818T213023Z_000287` has been sitting in
   `specifier/inbox/new/` since 22:30 with nobody in that hat to
   take it. `handoffd` did **not** log `chase-rotate` for this
   respawn — chase was `chase-wake-skip-busy coder` against the
   standing coder session. This was a **resident-invoked** rotate,
   not daemon chase.

## Likely trigger (not yet proven by a log line)

`PIPELINE.md` is inlined into every role's boot prefix, including the
standing specifier. The "Mono-router idle and open slots" / BL-550
paragraph tells a non-home role to run `rotate_to_role.sh <home>`
once the inbox is empty after a merge-up. Specifier.prompt itself
does **not** mention `rotate_to_role`. After minting BL-930 the
specifier inbox was empty; home on a router pack is coder.

`ready_for_next.sh` ROTATE_HOME is gated on
`conf-rotation-router?` and should **not** fire on `full-forge.conf`.
If this respawn was ROTATE_HOME, that gate failed. If it was the
model following inlined PIPELINE prose, the gate is working and the
prose is the leak.

## Related (do not conflate)

- **BL-550** (done) — ROTATE_HOME for a *mono-router* non-home
  resident. The intended pack is `config rotation router`. Do not
  "fix" this by deleting that path.
- **BL-518** — `rotate_to_role` / `respawn-as!` for the one resident
  pane. Correct on mono-router; the addressing (`first roles.tsv
  session`) is what makes it steal specifier on full-forge.
- **BL-921** / archived operator intake
  `INTAKE-active-role-file-identity-mismatch-holding-loop.md` —
  chase trusts the marker over live pane identity **on mono-router**.
  Different pack, different symptom (false wakes / Holding loop).
- **BL-926** (active) — rotate-gate refuses rotation into the
  parcel's own owner. Gate for an in_process parcel, not "do not
  rotate a standing full-forge pane".
- **BL-927** (paused) — departing role from live identity, not the
  marker. Same family of identity bugs; does not stop rotation from
  firing on a no-rotation pack.
- **BL-645** (epic, stereo-router) — notes that
  `mono-router-resident-session` is a singleton ("first
  non-coordinator roles.tsv session") and cannot address a specific
  resident. Future topology, not this full-forge theft.

## What to mint

A defect: on a pack that is **not** `config rotation router`,
`rotate_to_role.sh` / `rotate-resident-to!` must not respawn a
standing role's pane as a different role. PIPELINE.md (and any other
boot-inlined rotate-home prose) must not instruct a standing
full-forge specifier to rotate home to coder.

Suggested split if INVEST fails Small:

1. **Addressing / no-op:** `rotate-resident-to!` refuses (loud) when
   the pack is not rotation-router, *or* respawns only a true
   singleton resident, never `swarmforge-specifier` on a 7+1 pack.
2. **Prose:** PIPELINE.md BL-550 rotate-home text is not inlined as
   an instruction for standing full-forge roles (reference/ or
   pack-gated). Run the boot-prefix budget gate if you touch a
   boot-inlined file.

Do not fold this into BL-926/BL-927. Those assume rotation is
supposed to happen.

## Locked decisions (this conversation)

- Capture for specifier to mint. Do **not** ad-hoc kill either live
  Coder (the stolen specifier pane is mid-BL-930; the standing coder
  pane is on BL-925).
- Do **not** Qjump unless the human says so.
- Specifier pane is currently the stolen Coder — a specifier mailbox
  wake will land on that occupant until someone rotates the pane
  back with `rotate_to_role.sh specifier` (or respawns `specifier.sh`
  into `swarmforge-specifier`). The durable copy is this root file.

## Disposition

Drained 1:1 by the specifier 2026-08-18 into **BL-931**
(`backlog/paused/BL-931-rotate-steals-a-standing-pane-on-a-pack-that-has-no-rotation-router.yaml`,
`specs/features/BL-931-rotation-is-refused-on-a-pack-that-has-no-rotation-router.feature`).

The suggested split was taken, but only half 1 became a ticket. Half 2 (the
boot-inlined `PIPELINE.md` rotate-home prose) is prose in a file the specifier
owns with no gateable acceptance of its own, so per BL-798 it was landed
directly in this same commit rather than minted; BL-931 `notes:` records that.

The intake gate hypothesis was probed and **disproved**: `conf-rotation-router?`
returns false on `full-forge.conf` and `rotate-home?` returns false for a
specifier with home coder, so `ready_for_next.sh` ROTATE_HOME did not fire.
The gate is working; the resident-invoked rotate path simply has no gate.
