# Property-lane triage — QA note 00_20260822T134343Z_000879

**Reported:** "Property lane flaky under worktree load: bl857,796,643,968,948 - investigate"
**Disposition:** split 1:4 (BL-1061, BL-1062, BL-1063, BL-1064) under the specifier's
Consolidation Authority. The five named files have **four** distinct mechanisms, and the
reported diagnosis ("under worktree load") is accurate for **one** of them.

## Source run

`.worktrees/QA` property lane, 2026-08-22, log captured at
`<QA scratchpad>/properties.log` (53220 bytes). Host at the time: 20 cores,
19904 MB RAM, load average 13.25, 6191 MB available, 6 vitest forks + main live.

## Findings

| File | Observed failure | Mechanism | Load-related? | Ticket |
|---|---|---|---|---|
| `bl857TunnelOwnershipInvariants` | inv 1 + inv 3 fail on FIRST case (202ms, 29ms); counterexamples `[1,1]`, `["unrelated",false]` | Drives the real reap edge, which runs `pgrep -fl -- "run $name"` against the **host** process table (`tunnel_ownership_lib.sh:166`); fixture binds the production name `swarmforge-bubble` | **No** — contamination | BL-1061 |
| `bl968MaterializedGuardSensitivity` | `reach floor: class benign-subprocess drawn 4 < 5 of 24` | Absolute coverage floor over an **unseeded** draw: 3 classes, `NUM_RUNS=24`, `CLASS_FLOOR=5` | **No** — seed luck | BL-1062 |
| `bl948SocketFixtureInvariants` | `expected every death shape drawn, got nonzero, throw` (2 !== 3) | Same shape: `fc.constantFrom` over 3 shapes, `numRuns: 12`, asserts `drawn.size === 3` | **No** — seed luck | BL-1062 |
| `bl796NvmNodePathFollowUpAdoptInvariants` | inv 1 fails first case (476ms), `["/usr/bin:/bin", false]` | Reads a marker written by a **backgrounded** child with no wait/poll | **Yes** | BL-1063 |
| `bl643NonPipelineAgentPaths` | both tests fail; `row "Front Desk" log literal(s) not found ... [".swarmforge/operator/front-desk-diagnostics.log"]` | Grounding falls back to the launcher, which never writes that literal | **No** — deterministic, reproduces on `main` | BL-1064 |

## Probability arithmetic (BL-1062)

Computed from the checked-in constants, not estimated.

- **bl968** — 3 classes drawn uniformly, 24 runs, floor 5.
  Per class, `P(X <= 4)` under `Binomial(24, 1/3)` = **5.9%**.
  Across three classes, roughly **16% of runs** fail on a correct implementation.
- **bl948** — 3 shapes, 12 runs, requires all 3 drawn.
  `P(some shape missing) = 3*(2/3)^12 - 3*(1/3)^12` ≈ **2.3% per run**.
  The file's own line-33 comment claims "every death shape is drawn by
  construction" — it is drawn by chance, and the observed red disproves it.

## Live process-table evidence (BL-1061)

Two processes matched the test's own `run swarmforge-bubble` pattern at triage time:

- **PID 316866** — the operator's genuine tunnel:
  `/home/carillon/.local/bin/cloudflared tunnel --config /home/carillon/.cloudflared/config.yml --no-autoupdate run swarmforge-bubble`
- **PID 752728** — a fake cloudflared **leaked by an earlier property run**, still alive:
  `bash /tmp/bl787-ready-prop-sw7H7K/bin/cloudflared ... run swarmforge-bubble`

`stop_ancillary_services.sh` reaps through the same name-matched enumeration, so a
fixture bound to the production name means the suite can signal the operator's real
tunnel. That is why BL-1061 is severity high.

**Not swept by me:** PID 752728 is not mine to kill (surface, never sweep). Recorded in
BL-1061's notes as an operator action.

## Grounding gap evidence (BL-1064)

Measured in the **master** checkout at `a7390808f` (i.e. on `main`, not only in the
reporting worktree):

- `swarmforge/scripts/launch_front_desk.sh` contains `front-desk-supervisor` **4x**,
  `front-desk-diagnostics` **0x**.
- The diagnostics literal is written by `extension/src/tools/telegram-front-desk-bot.ts`.
- `LOG_VERIFICATION_SOURCE_OVERRIDES` already carries this exact shape for three other
  rows (Babysitter, Support, Model Steward); Front Desk is a fourth case with no entry.

## Relationship to existing tickets — checked, no overlap

- **BL-1007** (paused) explicitly scopes the property lane OUT ("Property-runner
  reachability floors likewise stay absolute, never scaled"). That ruling is not
  reopened by BL-1062: the question here is whether the floors are satisfiable at the
  configured `numRuns` at all, which is independent of load and of scaling.
- **BL-1042** (paused, approved) explicitly scopes fork pools OUT ("seat counts, fork
  pools and model tiers are not this ticket").
- Neither covers any of the four mechanisms above.

## Correction to the reported diagnosis

Recorded deliberately, because a deterministic red filed as a flake gets re-run instead
of fixed: **BL-1064 is red on `main` on every host, every run.** While it stands, no role
can get a clean property-lane run for any ticket — the condition BL-816 names as training
a swarm to wave a red lane through.

## Also observed, not ticketed

`test/onboarderLauncherPidGuard.property.test.js` ran **54941ms** — within ~9% of the
60000ms birpc `onTaskUpdate` heartbeat that `vitest.properties.config.mjs` documents as
non-configurable. Not a failure today and not folded into any of the four above (it is a
different mechanism and would break their INVEST-Small cut), but it is close enough to
the ceiling to be worth a ticket if it grows.
