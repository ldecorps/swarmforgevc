# BL-963 — architect review pass 1: BOUNCE to coder (complete inventory)

- **Ticket**: BL-963 — the open-slot nudge consults the promotion gate chain (`type: defect`, `severity: medium`, M8)
- **Commit reviewed**: `8bfecb4ae0` (cleaner) — coder `5040d45b9`
- **Reviewer**: architect, 2026-08-20
- **Verdict**: **BOUNCE to coder — inventory items: D1 (one item).**

The architecture is right: eligibility is decided by `promotion-gates-lib/evaluate`
itself, never a second implementation (BL-663, invariant 1's structural half). The
defect is one reachable candidate shape that slips through the filter and
reproduces the exact harm the ticket exists to prevent.

---

## D1 — a candidate refused by human_approval **and** another gate stays nudge-eligible

**Class**: `behavior` · **Blamed**: coder · **Files**:
`swarmforge/scripts/chase_sweep_lib.bb` (`nudge-eligible-candidates`),
`swarmforge/scripts/test/bl963_nudge_gate_chain_property_runner.bb` (the hole that
hid it)

`nudge-eligible-candidates` keeps a candidate when the verdict's single reported
gate is `human_approval`:

```clojure
(or (:ok verdict) (= "human_approval" (:gate verdict)))
```

But `evaluate` is **first-failing-gate-wins**, and its fixed order puts
`human-approval-refusal` **before** `depends-on-refusal` (`promotion_gates_lib.bb`
:328-331, with BL-957's own comment stating that order deliberately). So a ticket
that is BOTH pending approval AND blocked on an unlanded dependency reports
`human_approval` — and is kept.

**Measured against the shipped code**, four candidates through the real chain:

| Candidate | `evaluate` verdict | kept by the filter? |
|---|---|---|
| pending approval **+ unsatisfied depends_on** | `ok=false gate=human_approval` | **YES — the defect** |
| pending approval only | `ok=false gate=human_approval` | yes (correct, invariant 2) |
| approved + unsatisfied depends_on | `ok=false gate=depends_on` | no (correct) |
| approved, no deps | `ok=true` | yes (correct) |

**This contradicts the ticket's own invariant 2**, whose wording is *"a candidate
whose **only** refusal is human_approval remains nudge-eligible"*. The doubly-refused
candidate's only refusal is not human_approval. Invariant 1 says the same from the
other side: never name/count/escalate on a candidate refused *for any reason other
than* human_approval.

**The harm is the ticket's own stated harm, not a theoretical one.** In
`handoffd.bb`'s `open-slot-nudge-sweep!` the same `eligible` set feeds all three
consumers — `(count eligible)` for the fire decision, `top-open-slot-candidate` for
naming, and escalation tracking. So while such a ticket sits pending, every open
slot fires a nudge naming it and accrues SUP-1 escalation state, and approving it
promotes nothing because the dependency gate still refuses. That is precisely
*"fire on nothing promotable, and drive false SUP-1 escalations"* from the title.
The in-code comment added by this parcel — *"a candidate the chain refuses for
anything but human_approval is invisible to every one of them"* — is false for this
shape.

Reachability is ordinary, not exotic: a newly minted ticket that depends on unlanded
work and awaits approval. **BL-963 itself was such a ticket** (`depends_on: [BL-957]`,
approval pending at mint).

### Why neither gate caught it

- **Property runner**: `gen-candidate` builds three **mutually exclusive** kinds —
  `:allowed` (approved + satisfied dep), `:approval` (pending, `deps []`),
  `:dep-refused` (approved + unsatisfied dep). The pending-AND-dep-blocked
  combination is never generated, so the property passes without ever seeing it.
- **Acceptance**: scenario 02 is scoped to a ticket *"refused **solely** by the
  human_approval gate"*, and scenario 03 to *"every candidate refused for a reason
  other than human_approval"*. The overlap case falls between them.

**Remediation**: decide eligibility on the full refusal set rather than the single
first-failing gate — e.g. keep a candidate only when `(:ok verdict)` or when
`human_approval` is its *sole* refusal (re-evaluating with approval satisfied, or
having `evaluate` expose all failing gates). Then add the missing generator arm
(pending **and** dep-refused) with a coverage floor, and an acceptance scenario for
it, so the fix is gated rather than just applied.

---

## Everything else — run and PASSED

| Check | Result |
|---|---|
| Invariant 1 structural half (same evaluate chain, no second implementation) | **HOLDS** — `nudge-eligible-candidates` calls `promotion-gates-lib/evaluate` directly; no rival gate logic anywhere in the parcel. |
| `depends_on: [BL-957]` satisfied | YES — BL-957 is in `backlog/done/M8/` on both `main` and `origin/main`. |
| Property runner | ALL PROPERTIES HOLD — 40 runs through the REAL evaluate chain and REAL escalation machine; coverage `{:refused-top 14, :approval-named 14, :all-refused 12, :mixed 14}`. Sound as far as it generates; see D1 for the hole. |
| Acceptance 01–04 | 4/4 pass |
| Dependency-rule gate (BL-259, hard gate) | **RUN, exit 0, clean** |
| Capacity short-circuit | Correct — `eligible` is computed only when a slot is genuinely open, so the recursive `done/` scan is skipped when the decision would be false anyway. |
| Escalation machine | Untouched, as the ticket requires; it only ever sees what the filter passes — which is why D1's leak reaches it. |
| Architecture | Pure eligibility filter in `chase_sweep_lib`, impure context assembly in `handoffd` — the right split. |

No check was blocked.
