# BL-900 — hardener pass — 2026-08-16 — BOUNCE

## Scope reviewed

Batch parcel received from architect (`merge_and_process architect
ccaed5dd7c`), containing two tickets: BL-624 (D1 remediation — see
disposition below, forwarded clean) and BL-900 (this bounce). This report
covers BL-900 only.

Commit in scope: `324ef75c0` ("BL-900: rank promotion candidates by their
containing epic's priority before their own", by coder), merged through
cleaner (`96c2148cf`) and architect (`ccaed5dd7c`).

## Checklist completed this pass

1. **Babashka unit suite** (`swarmforge/scripts/test/promotion_gates_lib_test_runner.bb`):
   ALL PASS, including the new `epic-priority`/`epic-priority-index`/
   `rank-candidates` epic-aware assertions.
2. **Babashka property suite** (`promotion_gates_lib_property_runner.bb`):
   500 runs/property, ALL PROPERTIES HOLD, including new P9 (expedite bucket
   still first regardless of epic priority) and P10 (deterministic total
   order under shuffled enumeration).
3. **`chase_sweep_lib.bb` dispatch-gap suite** (`dispatch_gap_test_runner.bb`,
   covers `top-open-slot-candidate` / `top-expedited-paused-candidate`):
   ALL PASS — but see D1 below: this suite has zero epic-priority coverage,
   which is the symptom, not a false negative.
4. **Acceptance** (`specs/pipeline/scripts/run_acceptance.sh
   specs/features/BL-900-epic-priority-before-ticket-priority.feature`):
   9/9 scenarios pass.
5. **BL-113 soft Gherkin mutation** (`run_gherkin_mutation.sh ... soft`):
   20 mutations, 9 killed, 11 survived. All 11 survivors verified as
   equivalent mutants (BL-234), not forced-killed:
   - **m1, m2, m4, m5** (`examples[0]`: `epic_a`/`epic_b`/`own_a`/`own_b`) —
     row asserts "epic priority dominates own priority" with a wide
     epic-priority gap (5 vs 40). `rank-key`'s epic-priority term is a plain
     numeric `<` comparison; any mutated value that preserves `epic_a <
     epic_b` (14 still < 40; 42 still > 5) or leaves `own_a`/`own_b`
     unreached (irrelevant once epic priority already decides) cannot change
     the winner. Equivalent.
   - **m6, m7, m9, m10** (`examples[1]`, same shape, epic_a=40 > epic_b=5):
     identical reasoning, mirrored direction.
   - **m11, m12** (`examples[2]`: `epic_a`/`epic_b`, tied at 40/40) — mutating
     either off the tie (31, 48) still leaves `epic_a < epic_b` or `>`, so
     BL-A still wins — now via the epic-priority term instead of the
     own-priority tie-break the row was written to exercise, but the
     assertion only checks the winning id, not the deciding term. The exact
     tied-epic-priority case (`epic_a == epic_b`, tie-break falls to
     `own_a`/`own_b`) is independently, fully covered by `examples[3]`
     (epic_a=epic_b=40, own_a=own_b=50) — all 5 of ITS mutations (m16-m20)
     were killed, including the id tie-break. Equivalent, and not a real gap
     because the boundary case is exercised elsewhere in the same Outline.
   - **m15** (`examples[2].own_b`: 90 -> 97) — same tied-epic-priority row;
     `own_a` is 1, far below either 90 or 97, so the tie-break outcome is
     unchanged for any `own_b > 1`. Equivalent.
   - `scenarios: []` in the feature file's embedded manifest is EXPECTED
     here (BL-502): the one mutated scenario (the Outline) had survivors, so
     `new-manifest` correctly omits it; this is not evidence the tool failed
     to run (BL-460/BL-502 traps both checked against this run's own stdout
     summary line, not just the manifest).
6. **CRAP/DRY**: N/A this pass — no production TypeScript changed (BL-624's
   fix and BL-900 are both outside `extension/src/*.ts`); babashka has no
   mutation/CRAP/DRY tooling wired (engineering.prompt Startup Tools),
   covered instead by items 1-3 above.
7. **Orphaned-process check**: `pgrep -fl 'node --test|stryker'` clean
   before and after.

## D1 — behavior defect: two of three declared `rank-candidates` call sites never receive the epic-priority index

**Class:** behavior. **Blamed role:** coder.

**Ticket's own scope statement** (BL-900 `description:`, "Scope" section):
> Confirmed as the live path rather than assumed: `rank-candidates` is
> called by `promotion_gates_cli.bb`, `promote_and_route_next.sh` and
> `chase_sweep_lib.bb`.

**What was actually wired:** `rank-candidates` gained a 2-arity form
(`[candidates epic-index]`), defaulting to `{}` when only 1 arg is given
(`promotion_gates_lib.bb:142`). `promotion_gates_cli.bb`'s `cmd-select` was
updated to build and pass a real `epic-priority-index` (`promotion_gates_cli.bb:86,95`)
— this is the path `promote_and_route_next.sh` actually drives (`bb
promotion_gates_cli.bb select ...`, confirmed by reading
`promote_and_route_next.sh:210,216`), so 2 of the 3 named call sites are
correctly epic-aware.

The THIRD named call site, `chase_sweep_lib.bb`, was not touched at all:
`grep -n epic swarmforge/scripts/chase_sweep_lib.bb` returns zero matches.
Its two `rank-candidates` calls
(`top-open-slot-candidate` at line 998, `top-expedited-paused-candidate` at
line 1012) both use the 1-arity form and therefore silently rank with an
empty epic-index — every candidate falls back to its own `priority:`,
i.e. exactly the PRE-BL-900 algorithm, regardless of this parcel landing.

**Concrete failure scenario:** two eligible paused candidates, A (epic
tracker priority 5, own priority 90) and B (no epic, own priority 1). Real
promotion (`promote_and_route_next.sh` -> `promotion_gates_cli.bb select`)
now correctly picks A (epic priority 5 beats B's own priority 1 by BL-900's
own worked example — this is literally scenario 01's first Examples row).
But `chase_sweep_lib.bb`'s `top-open-slot-candidate`, used to name the
"top candidate" in the BL-798 open-slot escalation nudge sent to the
coordinator, still picks B — because its call site never built or passed
an epic-priority-index. The escalation note now names a DIFFERENT ticket
than the one that will actually be promoted next, which is precisely the
kind of misleading operator signal BL-798's own SUP-1 incident ("a
ticketless nudge was treated as noise") was written to prevent by making
nudges concrete and trustworthy.

**Why this is real, not a flake or an out-of-scope judgment call:** the
ticket's own scope note treats all three call sites as equally in-play
("confirmed... rather than assumed", explicitly naming
`chase_sweep_lib.bb`) — there is no `out_of_scope:` entry, invariant, or
`notes:` remark anywhere in the ticket excluding
`chase_sweep_lib.bb`/BL-798's escalation-nudge naming from epic-priority
awareness. No test in `dispatch_gap_test_runner.bb` or
`bl798_open_slot_escalation_property_runner.bb` exercises epic priority for
either function (both greps come back empty), consistent with the call
sites having been overlooked rather than deliberately left alone.

**Remediation pointer:** in `chase_sweep_lib.bb`, build an
`epic-priority-index` at each of `top-open-slot-candidate` and
`top-expedited-paused-candidate`'s own call boundary (both already have
access to `root` via their existing callers — `promotion-gates-lib/epic-priority-index
root`, the same function `promotion_gates_cli.bb`'s `cmd-select` already
calls) and pass it through to `rank-candidates`. Add coverage mirroring
`promotion_gates_lib_test_runner.bb`'s own BL-900 assertions, applied
through `top-open-slot-candidate`/`top-expedited-paused-candidate`
specifically (a candidate that only wins once epic-priority is considered).
Routed to coder as the implementing role for BL-900 (Article 4.3 default —
the gap is in this ticket's own declared scope, not a pre-existing
condition another role introduced).

## Disposition

One bounce, one defect (D1); everything else in the full inventory above
(items 1-7) is clean. BL-624, which shared this batch, is a separate
disposition — see the accompanying `git_handoff` to documenter for that
ticket. Routing BL-900 to coder.

By hardender.
