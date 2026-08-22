# BL-1035 hardener pass — 2026-08-22

**Parcel:** architect forward `2fad95cda9` (evidence-only commit; the real
diff is the coder's own `1cea4f7a3`, "a respawned front-desk bot is judged
on its own heartbeat, not its predecessor's"), merged into hardender.
Architect reviewed clean, no defect found, forwarded as-is.

**Ticket-location staleness (not a defect, not re-investigated):** the
architect's own evidence file already traced and ruled harmless the same
`backlog/paused/` vs `main`'s `active/` staleness I observed on first
reading this ticket — the coder's branch forked before the coordinator's
promotion commit landed on `main` and never re-synced; content is unaffected
and it self-resolves at QA's landing merge. Not re-litigated here.

**Verdict: hardened. One real mutation gap closed with a test.** This is
`mutation_cost: low` and a genuinely small, well-scoped fix (one `let`
binding added to one predicate) — the architect's own non-vacuity proof
already independently reproduced both the shipped defect (87/87 P1+P2
failures) and the BL-370-reintroducing break (159/159 P3 failures) against
the real property runner, so this pass looked for what neither the unit
suite nor the property runner could see by construction, rather than
re-proving what was already proven.

## The gap: `>=` boundary on "is this heartbeat the child's OWN"

The fix's `own-heartbeat-ms` binding is:

    (when (and last-heartbeat-ms
               (or (nil? started-at-ms)
                   (>= last-heartbeat-ms started-at-ms)))
      last-heartbeat-ms)

The `>=` — a heartbeat written EXACTLY at spawn time counts as the child's
own, not the predecessor's — has a design comment calling this out
explicitly ("a heartbeat written exactly AT spawn counts as the child's
own"), and both the unit test runner and the property runner DO construct
this exact-equality case. But neither can actually tell `>=` apart from a
strict `>` at that boundary, because **every fixture in both files pins
`stall-ms == grace-ms == 90000`** (the property runner literally
`(def stall-ms 90000) (def grace-ms 90000)`, both constants). When the two
windows are equal and the heartbeat sits exactly at spawn time, "grace still
running" and "heartbeat still fresh" end at the identical clock instant, so
whichever way the boundary comparison goes, the two paths through the
predicate arrive at the same verdict by coincidence. Hand-verified: changing
`>=` to `>` in a scratch-restored copy left `front_desk_supervisor_lib_test_runner.bb`
at `ALL PASS` and `bl1035_startup_grace_property_runner.bb` at
`ALL PROPERTIES HOLD` (400/400), including its own `:at-boundary` coverage
counter (120, well over its floor of 80) — that counter tracks the CLOCK
boundary (`now` relative to `started-at + grace-ms`), a different boundary
from the heartbeat-value one this gap is about, which is why it didn't help.

Added one test with `grace-ms` (1000) strictly shorter than `stall-ms`
(90000) and a heartbeat exactly at spawn: after the (short) grace ends but
well before the (long) stall window, the real code correctly says "not
stale" (the at-spawn heartbeat is the child's own and still fresh), while
the `>` mutant treats it as not-the-child's-own and falls to the
unconditional-stale branch once grace has elapsed. Verified the mutant now
fails exactly this one new test, restored, re-confirmed `ALL PASS`.

## Non-gap: the outer grace-boundary and the final stall-boundary

Both already independently pinned by existing tests (`bl1035-02`'s
"exactly AT the end of the grace" case for the former; the original BL-370
"exactly AT the stall window boundary" case for the latter) — not
re-litigated.

## Standing whole-tree guards

Parcel touches `specs/pipeline/steps/` (new
`bl1035RespawnedBotGetsItsOwnGraceSteps.js` + `index.js` registration). Ran
all 11 guard test files: 9/11 clean. The 2 failing
(`tempDirTrapGuard`, `tmuxReaperGuard`) are the same pre-existing pair
flagged repeatedly this session, now ticketed as BL-1032/BL-1033 (received
via QA's BL-1010 merge-up broadcast earlier in this session); confirmed
still outside this parcel's changed-file set.

## BL-113

No Scenario Outline / Examples in this ticket's feature file (all five
scenarios are plain `Scenario:`), so BL-113 Gherkin mutation does not apply
here — nothing to defer.

## Verification re-run live

- `bb swarmforge/scripts/test/front_desk_supervisor_lib_test_runner.bb` →
  **ALL PASS** (11 new BL-1035 cases at the architect's pass, now 12 with
  this pass's addition).
- `bb swarmforge/scripts/test/bl1035_startup_grace_property_runner.bb` →
  **400 runs, ALL PROPERTIES HOLD**, unaffected by this pass (no production
  code changed).
- `node specs/pipeline/cli.js specs/features/BL-1035-a-respawned-bot-gets-its-own-startup-grace.feature`
  → **5/5**.

No production code was touched this pass — only the `.bb` test runner. No
Stryker/CRAP/DRY applicable (pure Babashka, no wired tool per
engineering.prompt; the one production file
(`front_desk_supervisor_lib.bb`) is unchanged from the architect's own
verified copy).

— By hardener.
