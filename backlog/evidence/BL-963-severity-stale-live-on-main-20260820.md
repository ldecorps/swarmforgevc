# BL-963 — severity rationale is now stale; the D1 defect has already shipped to `main`

- **Discovered**: architect, 2026-08-20, while processing QA's BL-948 merge-up
  broadcast (`38ca06c73`).
- **Not a new bounce** — BL-963 is already active, `assigned_to: coder`,
  already bounced once for exactly this defect
  (`backlog/evidence/BL-963-architect-review-20260820.md`, D1). This is a
  severity/urgency correction, not a new finding of D1 itself.

## What happened

1. I reviewed BL-963 directly (commit `8bfecb4ae0`), found D1 (a candidate
   refused by `human_approval` **and** `depends_on` stays nudge-eligible,
   reproducing the ticket's own stated false-escalation harm), and did a
   **scoped revert** of BL-963's changes out of my own branch
   (`09f97f2ec`), keeping sibling tickets 948/964/965 moving.
2. Cleaner later produced a **second** shared batch commit (`a974fefcff`,
   message: "BL-948, BL-962 bounce D1 re-fix, BL-964, BL-963, BL-965") that
   re-bundled BL-963's **original, unreverted, still-defective** code
   alongside the re-fixed BL-962 and the untouched 948/964/965. My scoped
   revert lived only on my prior branch tip and was never an ancestor of
   this new batch commit.
3. An architect review pass scoped to BL-948 (`BL-948-architect-review-
   20260820.md`, commit `9159fbc1c8`) correctly verified BL-948's own
   concern and passed it forward — but did not catch that BL-963's known,
   already-bounced D1 defect was riding along unfixed in the same shared
   commit. That parcel proceeded through hardener → documenter → QA
   (`38ca06c73`) and **QA already landed it on `main`** (confirmed: `git
   merge-base --is-ancestor 5040d45b9 main` → YES; `git merge-base
   --is-ancestor 09f97f2ec main` → NO — my revert never reached `main`).
4. Confirmed directly: `main`'s `swarmforge/scripts/chase_sweep_lib.bb`
   contains `nudge-eligible-candidates` with the unfixed line
   `(or (:ok verdict) (= "human_approval" (:gate verdict)))` right now.

## Why this changes BL-963's severity

BL-963's own severity rationale (`severity: medium`) states explicitly:
*"no live misbehavior today, but the defect arms the moment BL-957 lands."*

BL-957 has landed: it is in `backlog/done/M8/`, and `main`'s
`promotion_gates_lib.bb` `evaluate` chokepoint already wires
`depends-on-refusal` into the fixed gate order, after
`human-approval-refusal`, exactly as D1's evidence describes. The
precondition the medium-severity rationale was conditioned on **not**
holding is now true.

**Practical effect, live on `main` right now**: any paused ticket that is
both pending `human_approval` *and* has an unsatisfied `depends_on` will be
named by the open-slot nudge, counted toward the fire decision, and accrue
SUP-1 escalation state — even though the promotion gate will refuse it on
`depends_on` the moment approval lands. This is the exact false-escalation
harm BL-963 exists to prevent, and it is not hypothetical or future-dated
anymore.

## Recommendation (not mine to decide — routing to specifier + coordinator)

- Re-triage BL-963's severity given the now-true precondition; at
  `high`/`critical` it becomes expedited under Article 3.2.4.
- No new ticket needed — BL-963 already tracks the fix and is already with
  coder. The fix, when it lands, must correctly patch `main`'s *current*
  (unreverted) `chase_sweep_lib.bb`, not the pre-batch state.
- Cleaner's batch-commit process let an already-bounced ticket's defective
  code re-enter an unrelated ticket's lineage undetected; worth a
  `rule_proposal` separately (not blocking this note) — an architect
  reviewing ticket X in a shared batch commit should check whether the same
  commit also carries a *previously bounced, still-unresolved* sibling
  ticket's changes before passing X forward.
