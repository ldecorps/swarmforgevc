# BL-1559 - specifier unowned-red reproduction, 2026-09-14

Trigger: architect note from the BL-1541 parcel, 2026-09-14 05:42Z,
"BL-1541 spec-gap: bl983 two-seat floor ~10% flakes, see e85b74df4d". The
architect's evidence (`backlog/evidence/BL-1541-architect-20260914.md`)
reproduced 2 of 4 full runs at `:two-seat 5` and routed it as a note, not a
bounce, because BL-1541's constraints forbade loosening any floor.

## 1. The site

`swarmforge/scripts/test/bl983_stage_queue_property_runner.bb`:

- line 49: `runs` = `PROPERTY_RUNS` or 16
- line 50: `rng` seeded from `System/nanoTime` - no seed knob, so no
  deterministic repro; the odds are read off the source instead
- line 125: `n-seats (+ 2 (rand-int* 2))` - a fair coin, two or three seats
- line 127: `n-parcels (inc (rand-int* (inc n-seats)))` - uniform 1..n-seats+1
- line 129: the draw is counted as `:three-seat` or `:two-seat`
- line 150: a draw is `:all-busy` when `n-parcels >= n-seats` (capped at 8)
- line 203: floors `{:two-seat 6 :three-seat 3 :all-busy 4 :redeliver 4 :forward 4}`,
  absolute, asserted after the loop with `fail!`

## 2. The odds (exact, from the source)

```
python3 -c "from math import comb; p=lambda n,k: sum(comb(n,i) for i in range(k))/2**n
print(p(16,6), p(16,3))"
-> 0.1050567626953125 0.0020904541015625
```

- P(two-seat < 6 of 16 fair coins) = 6885/65536 = 10.5%
- P(three-seat < 3) = 0.2%
- P(either) = 10.7%
- all-busy < 4: simulated 200000 runs of the two draws above: 0.15%
  (about 1 in 650)
- redeliver / forward: their condition (some seat holds an in_process
  parcel after the polls) is true on every draw with >= 1 parcel, and
  n-parcels >= 1 always; unreachable by a miss.

## 3. Full runs on main f939c2f357 (specifier, 2026-09-14, 16 draws each)

| run | exit | wall (s) | coverage |
|---|---|---|---|
| 1 | 0 | 131 | `{:two-seat 9, :three-seat 7, :all-busy 8, :redeliver 8, :forward 8}` |
| 2 | 0 | 119 | `{:two-seat 7, :three-seat 9, :all-busy 8, :redeliver 8, :forward 8}` |
| 3 | 0 | 147 | `{:two-seat 7, :three-seat 9, :all-busy 8, :redeliver 8, :forward 8}` |
| 4 | 0 | 149 | `{:two-seat 9, :three-seat 7, :all-busy 8, :redeliver 8, :forward 8}` |
| 5 | 0 | 125 | `{:two-seat 8, :three-seat 8, :all-busy 8, :redeliver 8, :forward 8}` |
| 6 | 0 | 122 | `{:two-seat 8, :three-seat 8, :all-busy 8, :redeliver 8, :forward 8}` |

Six green of six (P = 0.895^6 = 0.51, so this is the expected outcome about
half the time and proves nothing by itself); every two-seat count sits
within 1 to 3 of the floor. With the architect's 4 runs the same day the
census is 10 runs, 2 misses, both at `:two-seat 5` - the only way the
runner can fail on this tree (every invariant held on every draw of every
run; no other `fail!` site fired). The runner has no seed knob, so the
odds in §2 are the reproduction, read off the source the way BL-1555's
bl956 half was. The all-busy, redeliver and forward counts hit their 8-cap
on every run.

## 4. Disposition

- Owner minted: BL-1559 (`type: defect`, `severity: high`,
  `backlog/paused/BL-1559-the-bl983-runner-constructs-its-seat-schedule.yaml`).
  Not folded into BL-1555: different lane (bb runner by name vs vitest
  properties lane), different helper, and BL-1555 is already approved
  (re-pending posts no fresh ask, BL-1455).
- Register: the bb row for this file, first_seen 2026-08-30 owner BL-1541
  (closed 2026-09-14), rewritten to owner BL-1559 first_seen 2026-09-14 -
  the date THIS red was first sighted. The rewrite rode the sibling
  retirement commit `28db2441b0` (same file edit, one pass); the other four
  BL-1541 rows were retired there after each runner re-ran green
  (`backlog/evidence/standing-reds-stale-rows-retired-specifier-20260914.md`).
- Runner cost on this host: 119-149 s per 16-draw run, two `swarm_handoff.bb`
  invocations per send since BL-1541 - which is why the ticket's feature
  drives the schedule helper and never shells the runner (BL-1358 ceiling).

By specifier.
