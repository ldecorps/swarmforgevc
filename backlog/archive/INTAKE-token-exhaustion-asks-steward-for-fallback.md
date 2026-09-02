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

---

## Drained 2026-09-02 (specifier) → BL-1335

Minted as **BL-1335** — "Token-exhaustion evidence is never promoted into a
failover record, so the wired outage-failover consumer only ever acts on
records a human typed by hand"
(`backlog/paused/BL-1335-exhaustion-evidence-opens-a-failover-record.yaml`).
Every human sentence quoted above is preserved verbatim in that ticket's
`source:` field, per Article 5.3.

**Why the resulting ticket is much smaller than this intake.** The intake's
"Required behaviour" lists five steps. Investigation at drain time found
steps 2, 3 and 4 — consult the steward, handshake, propose/apply at idle with
announcement and auto-revert — are ALREADY BUILT and running as BL-669, which
`handoffd.bb:3914` genuinely calls. Step 1, detection, is also already built
and running as BL-840, whose producer writes evidence continuously
(180KB on 2026-09 at drain time).

What is missing is only the bridge between them: the two use different files,
and the failover store BL-669 reads holds exactly one line, hand-typed by the
operator (`"recordedBy": "operator-session"`) for a "Token Plan weekly quota
exhausted" incident. So the intake's own scenario had already happened once,
and a human was the missing component. BL-1335 is that bridge alone.

Step 5's remaining half — closing the record when the period resets, so
BL-669's existing auto-revert fires — is named in BL-1335's `out_of_scope`
as its own slice, deferred rather than dropped.

One correction recorded for whoever follows the references: BL-669's
`out_of_scope` names BL-650 as an owner of outage records, but BL-650 is
"flow-watchdog measures parcel age in WALL-CLOCK time" and is unrelated.
BL-840 is the real producer.
