# INTAKE — BL-1186 approval ask with no ticket yaml (ghost approval)

**Source:** human (Laurent) via Telegram Approvals screenshot + Cursor forensics,
2026-08-27 ~12:48 BST  
**Status:** new intake, not minted  
**Priority:** high — human tapped **Approve** seven times; every tap was a no-op.
Approval surface is lying.

**Failure class (proposed):** `ghost-approval-ask` — Telegram buttoned ask exists
for a backlog id with **no live yaml** on disk (`no-ticket-file` per BL-582).

## What the human saw

Telegram **Approvals** topic: SwarmForge Concierge asks approval for **BL-1186**
(Deprecator child — identify unused/seldom-used functionality; 90d / <3 hits
thresholds). Tapping **Approve** returns:

> BL-1186: nothing was recorded (no-ticket-file). Your verdict is NOT saved — tell a human.

Buttons remain; verdict never sticks.

## Forensics (2026-08-27)

| Check | Result |
| --- | --- |
| `backlog/active/` or `backlog/paused/` yaml for `id: BL-1186` | **MISSING** — no file anywhere in backlog tree |
| Git history (main + backlog submodule) for `*1186*.yaml` | **NEVER COMMITTED** — zero commits |
| `backlog/topics/BL-1186.json` | Present — commit `e57bd9d51` 09:15 BST ("By coder") |
| `.swarmforge/operator/telegram-approval-ask-messages.json` | **BL-1186 registered** (messageId 51256, Approvals topic) |
| `.swarmforge/operator/concierge-tick-state.json` | `emittedKeys` includes `ApprovalRequested:BL-1186` and `:BL-1187`; **`pendingApproval: []`** now |
| Failed Approve taps (`front-desk-diagnostics.log`) | **7×** `record-no-op detail=BL-1186:no-ticket-file` — first **08:20 UTC**, latest **11:48 UTC** |
| Specifier handoffs | **08:16 UTC** — "BL-1186/1187 paused (usage-starved + ambulance release)"; **11:34 UTC** — "BL-1187 + BL-1188 spec-ready in backlog/paused/" — **but no yaml files exist for 1186/1187/1188** |

Parent epic: **BL-1172** (`backlog/paused/BL-1172-epic-deprecator-stale-rules.yaml`).
Human addendum ~08:31 BST (per topic text): mint BL-1186 as new child; do not expand
in-flight BL-1174.

## Why the yaml is missing (best current read)

This is odd but the evidence narrows it:

1. **An approval ask did fire.** `ApprovalRequested:BL-1186` is in durable tick
   state and the buttoned ask is in `telegram-approval-ask-messages.json`.
   Concierge only emits `ApprovalRequested` when `pendingApprovalFor` finds a live
   yaml with `human_approval: pending` (active or paused).

2. **The yaml was never made durable.** No git commit ever landed a BL-1186 yaml
   (or BL-1187/1188). Specifier **announced** paused tickets in handoffs but the
   files are not on disk now.

3. **Therefore: transient or uncommitted mint.** Most likely the specifier session
   wrote yaml into the working tree long enough for one concierge tick to see
   `human_approval: pending` and post the Approvals ask, then the yaml vanished
   before the human's first tap (**08:20 UTC** — already `no-ticket-file`). Causes
   to confirm: never `git add`/commit; lost on reset/checkout/sync; written outside
   `backlog/paused/` scan path; or session ended mid-mint.

4. **Stale ask persists.** Once posted, Telegram buttons survive even after
   `pendingApproval` drops to empty — taps keep failing with BL-582's honest
   `no-ticket-file` toast, but nothing auto-closes the ghost ask.

**Not** the 11:08 claim-progress halt root cause — first failed tap predates that
by ~3 hours (though halt may have destroyed any remaining uncommitted yaml).

## Immediate human impact

- **BL-1186 is NOT approved.** Do not treat repeated taps as success.
- Text `approve BL-1186` will also fail until yaml exists.
- Same risk for **BL-1187** / **BL-1188** if asks were posted (check Approvals topic).

## Ask for specifier / coordinator

### 1. Repair the mint (now)

- Create and commit the missing paused yaml(s), at minimum:

  `backlog/paused/BL-1186-deprecator-identify-unused-notify.yaml`

  with `id: BL-1186`, `human_approval: pending`, parent **BL-1172**, scope/thresholds
  from `backlog/topics/BL-1186.json`.

- Audit **BL-1187** and **BL-1188** the same way (handoffs claim they exist; they do not).

- Update **BL-1172** `decomposes_into` if children were minted but not listed.

- After yaml lands: human re-taps Approve **or** uses `approve BL-1186` text.

### 2. Mint a defect ticket (systemic)

Close the gap where an Approvals ask can outlive its yaml:

- **Pre-post gate:** refuse `ApprovalRequested` unless `findTicketFilePath` succeeds
  (mirror BL-582 record path).
- **Post-drop reconcile:** when a backlog id leaves `pendingApproval`, close or mark
  stale the buttoned ask in Approvals topic (BL-484 repaint path).
- **Mint durability check:** specifier handoff "spec-ready in paused/" must not ship
  without a committed yaml path in the same parcel/commit.
- Optional: babysitter WARN when `telegram-approval-ask-messages.json` keys ⊄ live yaml ids.

## Related

- BL-582 — no-op tap diagnostics (`no-ticket-file`)
- BL-1172 epic / BL-1174 in-flight (do not expand per human addendum)
- Separate incident same day: claim-progress halt / Live Screen (`failure_class: claim-progress-halt`)

## Evidence paths

- `backlog/topics/BL-1186.json`
- `.swarmforge/operator/front-desk-diagnostics.log` (2026-08-27T08:20–11:48Z)
- `.swarmforge/operator/telegram-approval-ask-messages.json` (BL-1186 entry)
- `.swarmforge/handoffs/specifier/sent/00_20260827T081619Z_000723_from_specifier_to_coordinator.handoff`
