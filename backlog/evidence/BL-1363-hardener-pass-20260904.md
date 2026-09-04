# BL-1363 — hardener pass, 2026-09-04

Merged architect commit `b478786c11` (clean pass, no bounce, verified the
close/rollback path against promotion's own model in detail —
`backlog/evidence/BL-1363-architect-20260904.md`). The merge also carried
BL-1390's coder rework fixing the live-origin-corruption incident — spot
checked, unaffected by this ticket's own review, matching the architect's
own note.

## Checks re-run, all independently

- `bash swarmforge/scripts/test/test_bl1363_close_ticket.sh` — run 4
  times (matching the architect's own flakiness check), all clean before
  my own additions; 20/20 after.
- `bash swarmforge/scripts/test/bl1363_close_ticket_property_runner.sh`
  — ALL PROPERTIES HOLD over 12 constructed cells.
- `run_acceptance.sh` on the BL-1363 feature — 5/5 PASS.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.

## BL-149 cooldown gate — hand-authored mutation sweep

`swarmforge/scripts/close_ticket.sh` — DECISION: run. No Babashka/shell
mutation tool wired (Startup Tools) — BL-638/BL-567 fallback. Wrote
`swarmforge/scripts/test/bl1363_close_ticket_mutation_sweep.sh`, 6
mutants targeting the safety-critical invariants (never a partial close,
never fall through to a raw commit past a refusal — the exact BL-1028
failure this ticket exists to avoid).

First pass: **3 killed, 3 SURVIVED** — all three real gaps, none
equivalent:

1. **`exit 1` dropped on integrity refusal** — `rollback_close` and the
   stderr message both still ran, so every existing file-state/stderr
   assertion in scenario 2 passed regardless; nothing checked the
   script's own EXIT CODE. A caller branching on `$?` (the coordinator,
   eventually) would read a genuine refusal as success. Closed by adding
   an exit-code check to scenario 2.
2. **Multiple-match refusal dropped** (`${#MATCHES[@]} != 1`) — no
   scenario ever gave the script two files matching the same `BL-id`
   glob, so an ambiguous id resolving silently to the first glob match
   had zero coverage. Closed with new scenario 07 (a duplicate file,
   confirms refusal and that neither file moves).
3. **Missing-milestone refusal dropped** (`[[ -z "$MILESTONE" ]]`) — more
   subtle than the other two. A first attempt at a covering scenario
   (through the real `commit_integrity_cli.bb`) still refused either way
   — that CLI independently rejects the malformed `backlog/done//<file>`
   destination for its own reasons, so the guard's own contribution was
   invisible through that path. Investigated directly: with the guard
   dropped AND the integrity CLI removed (the documented degraded
   fallback, mirroring promotion's own equivalent branch and never
   independently exercised by this suite before), the close **succeeds**
   silently, landing the ticket at `backlog/done/` root instead of
   refusing — confirmed live before writing the scenario. Closed with new
   scenario 08, built specifically in the degraded (no-CLI) path where
   the guard is load-bearing.

Re-ran the sweep: **6/6 killed, 0 survived, 0 equivalent**. Re-ran the
full e2e suite (20/20), property runner (12 cells), and acceptance (5/5)
after the fixes — all still green.

## BL-113 Gherkin mutation

No `Scenario Outline` in the feature (all five scenarios are plain
`Scenario:` blocks) — ran `run_gherkin_mutation.sh` to confirm rather
than assume: `"outcome": "inapplicable"`, matching BL-638.

## CRAP / DRY

This ticket's own diff touches no file under `extension/src` — N/A.

## Process/fixture hygiene

Confirmed no orphaned test processes from this pass. Swept a stale
`/tmp/bl1363-close.lock`/`.lock.owner` pair whose recorded owner PID was
already dead (not referenced by anything in this parcel's own files;
safe, harmless leftover removed).

## Result

Three real gaps found in a safety-critical close path, all closed with
non-vacuous tests confirmed against the real degraded/ambiguous
conditions they name, not accepted or dismissed. Forwarding to
documenter.

By hardender.
