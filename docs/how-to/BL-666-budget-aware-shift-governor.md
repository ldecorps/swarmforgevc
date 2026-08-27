# Budget-aware shift governor (BL-666)

*How-to. Task-oriented: pace 3×8 shifts against your prepaid token tank so
usage reaches weekly replenish without silent overspend.*

## The gap

BL-619 warns in the morning briefing when burn projection looks high, but
cadence stayed fixed — a 71%-used week at 2.2 days in still ran full shifts
until the tank emptied. BL-666 **acts** at each shift boundary (BL-660
applier): anchor-calibrated burn projection picks **full → SHORT → CHEAP →
SKIP**, always announced with arithmetic.

## How it works

Three pieces plus unchanged BL-305 backstop:

| Piece | Role |
| --- | --- |
| **Anchor** | You relay Usage % occasionally (same store as BL-619 `usage-anchor.js`). Two anchors + BL-664 transcript burn calibrate %-per-token between relays. Stale anchor (>3 days default) → **degraded mode**, labelled — never a confident exact projection. |
| **Burn meter** | BL-664 transcript walker measures tokens per shift per seat (including operator sessions). |
| **Governor** | `shift_schedule_applier_lib.bb` shells `budget-shift-governor.js` at shift boundaries. Verdict ladder prefers full hours, then trimmed SHORT, then ModelFactory **cheap** certified seats, then SKIP (approvals/Telegram still drain at next start). |

**Prepaid vs credits:** the governor never spends paid credits without explicit
human opt-in. PROVIDER_LIMIT / cooldown remains the hard floor.

## Operator check

1. Record an anchor when you check the app:
   ```bash
   node extension/out/tools/usage-anchor.js record <pct>
   ```
2. At the next shift boundary, confirm the governor announcement includes
   remaining %, days-to-reset, and measured vs affordable burn per shift.
3. When burn exceeds affordable pace (founding fixture: 71% at 2.2 days,
   ~32%/day measured vs ~6%/day affordable), expect a non-full verdict
   (SHORT, CHEAP, or SKIP — not silent full shift).

Inspect verdict JSON directly:
```bash
node extension/out/tools/budget-shift-governor.js
```

## Verify

```bash
cd extension && npm test -- budgetShiftGovernor
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-666-budget-aware-shift-governor.feature
```

Related: [Token-burn briefing warning](BL-619-token-burn-briefing-warning.md),
[Three named shift packs](BL-660-three-shift-packs-conf-selectable.md),
[Context telemetry producer](BL-665-context-telemetry-producer-wiring.md).
