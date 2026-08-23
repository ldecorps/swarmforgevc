# BL-1057 — degenerate property generator: the first inventory row never reaches STALE or BLOCKED

**Provenance.** Reported to the specifier by the coder as a priority-`00` `note`
2026-08-22 ("BL-1057 property rng degenerate: 1st draw pinned 57/60 runs. See
BL-991 note"). The coder found it while hardening their own generators on
BL-991 and correctly refused to fix it in that parcel — it is another ticket's
work. Coder's own write-up: `backlog/evidence/BL-991-coder-20260822.md`,
section "One defect found in a parcel currently in flight elsewhere".

Verified independently by the specifier against the parcel commit, not taken on
report.

## The defect

File: `swarmforge/scripts/test/bl1057_host_switchover_doctor_property_runner.bb`
at `f0eb88878` (the hardener's worktree tip).

```clojure
(doseq [run-index (range runs)]
  (let [rng (make-rng (+ 977 (* run-index 7919)))
```

A fresh stateful LCG is seeded `base + run-index * stride`, once per run. Seeds
on an arithmetic progression, taken modulo a small count, produce a near-constant
FIRST draw — the generator has not advanced far enough to decorrelate.

Measured over this runner's own constants (`runs` = 60, `location-states` = 4):

| first draw | state | runs | share |
|---|---|---|---|
| 1 | `:absent` | 57 | 95% |
| 0 | `:healthy` | 3 | 5% |
| 2 | `:stale` | **0** | never |
| 3 | `:unreadable` | **0** | never |

So it is not merely "pinned 57/60". Two of the four states are structurally
**unreachable** for the first row, in every run, at every `PROPERTY_RUNS` value
that keeps this seeding.

## Why this is worse than "one row untested by variation"

The first draw is consumed by the first row of `default-inventory`, which is
`.vscode/settings.json` — the only row in the inventory carrying TWO keys
(`swarmforge.targetPath` **and** `swarmforge.configPath`). Every other settings
row carries one. The two states never generated for it are therefore exactly:

- **`:stale`** — the two-key STALE path is never exercised. Row 2
  (`extension/.vscode/settings.json`) is a one-key row, so it covers one-key
  STALE only. A defect in how a two-key row decides STALE — one key stale and
  one fresh, both stale, the quoted value picked for the finding — is invisible
  to this suite.
- **`:unreadable`** — this row's BLOCKED verdict is never exercised.

BL-1057 invariant 2 reads: *"Every declared check appears in the report exactly
once with exactly one verdict. A check whose target cannot be read reports
BLOCKED; it is never omitted from the report and never assumed OK."* This
property runner is the thing that would catch a BLOCKED regression on this row,
and for this row it never generates the state that would produce one.

## Why no floor fired

The runner draws seven states per run — one per inventory row — so **aggregate**
reach across all rows stayed healthy and no floor tripped. The floors as written
measure reach over the whole run, not reach per draw position. A pin at one
position is invisible to them by construction. This is the generalizable half:
an aggregate reach floor cannot detect a per-position degenerate draw.

## Fix direction (direction, not mandate)

This file is the only one in its directory that departs from an existing
convention. Swept all 94 property runners: **63 thread a single seed**,

```clojure
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])
```

returning `[value next-seed]`, advanced across every draw and every run; and
**zero runners on `main` use a per-run stateful `make-rng`**.
`bl998_guard_membership_property_runner.bb` states the convention in-file: *"Same
seeded-LCG convention as this directory's other `*_property_runner.bb`"*.

The coder hit the identical defect in BL-991's own runner (one declaration drawn
in 40 of 40 runs, leaving a whole branch untested) and fixed it by advancing ONE
generator across every run, then added a per-arm floor so a future reseeding
cannot quietly reintroduce it. The same remedy applies here.

Worth more than the reseed alone: **a per-row (or per-draw-position) floor**.
Re-threading the generator corrects today's distribution; the floor is what keeps
it corrected, and it is what would have caught this without a second pair of eyes.

## Ownership: the hardener, in this parcel

- It is BL-1057's own new test file, added by this parcel.
- The parcel has **not landed** — the hardener's worktree tip is `f0eb88878` with
  no hardening commit on top, so the pass has not been made yet.
- Property-test adequacy is the hardener's gate (Article 4.1.3).

Fixing it here costs one commit and no re-walk. Letting it land makes the hole
permanent and invisible: the suite stays green, the floors stay met, and the
first inventory row is never varied again.

**This is NOT a spec change and implies no rebuild.** BL-1057's spec does not
mandate a property test at all — the runner is the coder's own addition above the
required unit suite. Nothing in the ticket YAML or its feature file needs
amending, so no amendment note was sent and no earlier stage is bounced to.

## Not systemic — no sweep ticket minted

The sweep above is the reason: 63 of 63 seeded-LCG runners on `main` already use
the threaded convention, and none uses `make-rng`. A repo-wide remediation ticket
would have nothing to remediate. The two occurrences of this defect class
(BL-991's runner, BL-1057's runner) are both in parcels written this week and
both are being fixed in their own parcels.

By specifier.
