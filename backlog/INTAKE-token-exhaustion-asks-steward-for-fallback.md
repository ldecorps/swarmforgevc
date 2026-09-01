# INTAKE — Token-exhaustion outage asks Model Steward for a handshaken fallback

**Source:** human via Cursor, 2026-09-01 ~08:36 BST  
**Status:** new intake, not minted  
**Priority:** high — production seats go dark on period caps; today recovery is
ad hoc while BL-669 already covers *provider* outages, not *quota/token-period*
exhaustion as a first-class “ask the steward” path.

## Goal

When a model **fails in production because tokens (or the plan period budget)
are exhausted for the current period**, **anyone who picks up on that outage**
— babysitter / coordinator / handoffd chase / operator — **asks Model Steward
for a fallback model**. The steward **handshakes** the substitute (reachable,
assignment-eligible for that seat) before anyone applies it.

## How this differs from what already shipped

| Mechanism | Covers | Gap |
| --- | --- | --- |
| **BL-669** outage-driven seat failover | Sustained **provider** outage records (BL-650); steward certified substitute at idle | Trigger is provider outage JSONL, not “this seat’s model hit period token/plan cap” |
| **BL-082** cooldown-aware wake | Role reported exhaustion + reset time → defer wake | Does not consult steward for a *different* model to keep the seat working |
| **BL-525** quota-state / cheap-mode | Factory assign can prefer non-exhausted providers when quota-state is populated | Not wired as “whoever saw the prod failure must ask steward + handshake” |
| **BL-552** quota epic (paused) | Broader budget manager vision | Not the thin production path |

This intake is the **thin production path**: exhaustion signal → steward
fallback consult → handshake → propose/apply under the same idle / announce
discipline as BL-669 (not a silent mid-turn swap).

## Trigger (what “fails in prod” means)

Any of:

- Provider/API errors that mean **period or plan quota exhausted** (429 with
  quota/billing semantics, explicit “credit/token exhausted until reset”,
  Token Plan window empty, etc.)
- A seat’s own report of token exhaustion with a reset time (BL-082 shape)
  when continuing on the **same** model is impossible until reset
- Operator / babysitter classification that the failure class is exhaustion,
  not a generic hang

Specifier should pin the exact signal sources (claude billing, OpenRouter,
Token Plan, Cursor, …) without requiring every vendor on day one — start with
the providers this host actually runs.

## Required behaviour

1. **Detect / classify** exhaustion (vs generic outage vs model bug)
2. **Consult Model Steward** for a fallback for that **seat/role** (reuse
   `assignment-eligible?` / role-matrix; prefer same agent family when
   mono-router home pokeability matters)
3. **Handshake** the candidate (credentials + endpoint alive; optional cheap
   probe) — same spirit as the pack-from-profile intake
4. **Propose or apply-at-idle** with announcement + COST/experiment log
   (mirror BL-669 attended vs unattended); **auto-revert** when the period
   resets / original model is healthy again if that matches outage-failover
   posture
5. **Never** leave the only recovery as “wait until reset” when a handshaken
   cheaper/alternate model could staff the seat

## Relations

- BL-669 — closest sibling; extend or parallel with an exhaustion trigger,
  do not fork a third assignment path (BL-1178 warning)
- BL-650 / provider-outages — may need an exhaustion subtype or a sibling
  ledger so the sweep has something to read
- BL-082 — wake deferral remains valid when *no* fallback handshakes
- BL-525 / quota-state.json — feed or consume; do not invent a second quota
  store without need
- BL-545 economic path — cheaper substitutes may be the right fallback class;
  exhaustion failover is incident-driven, economic review is scheduled

## Specifier notes

- Prefer extending BL-669’s consult/apply/announce skeleton over a greenfield
  failover stack.
- Firm: handshake before apply; no mid-turn swap; no uncertified override
  unless an existing explicit escape hatch already covers it.
- Link related: `INTAKE-model-steward-generates-pack-from-profile.md` (whole
  cast) vs this ticket (single-seat emergency substitute).
