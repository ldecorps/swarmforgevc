# Hotfix 2026-08-03 — mono-router self-starvation

Hand fix filed for adopt-and-review as **BL-795**. Live on the host since
the 2026-08-03 evening recovery; ticket-less until this evidence.

## Incident

Observed while **BL-787** was mid-pipeline:

1. Hardender held a BL-787 `git_handoff` in worktree `in_process` (claimed
   ~15:42 UTC). Chase nudged three times, armed `chase-escalations.json`
   `hardender: true`, then **stopped waking** (`decide-stuck-action` →
   `"alert"` with no further resume).
2. Resident rotated home to **coder** (empty inbox). Depth cap 1 blocked
   any other promotion.
3. Specifier had a directed `rule_proposal` in shared `inbox/new`. Every
   sweep logged `chase-rotate-skip-broadcast specifier` because
   `role-mail-row` / `actionable-mail?` counted only `git_handoff` + aged
   `note` as actionable — never `rule_proposal`.
4. Pokes at the non-preferred role returned `not-preferred` and **dropped**
   the rotate; the preferred role (hardender, holding work) was never
   acted on from those pokes.

Net: real work stuck mid-harden; resident idle at home; chase busy failing
on non-actionable Article 5.1 mail; board still said `assigned_to: coder`
(stale-holder class tracked separately as BL-794).

## Hand fix (master working tree, uncommitted)

| File | Change |
|---|---|
| `swarmforge/scripts/mono_router_lib.bb` | `actionable-mail?` treats `rule-proposal-count` like `git-handoff-count` |
| `swarmforge/scripts/handoffd.bb` | `role-mail-row` includes `rule_proposal`; `chase-rotate-to!` **redirects** to the preferred role instead of `skip-not-preferred` |
| `swarmforge/scripts/chase_sweep_lib.bb` | `"alert"` still calls `apply-stuck-nudge!` after arming escalation |
| `swarmforge/scripts/test/mono_router_lib_test_runner.bb` | asserts rule_proposal actionable |
| `swarmforge/scripts/test/test_chase_sweep.sh` | scenario 06 expects post-alert wake |
| `swarmforge/scripts/test/test_handoffd_rule_proposal_rotate_wiring.sh` | **new** — wiring test via `--print-preferred-rotate-target` |

## Overlap note

`handoffd.bb` in the same working tree also carries the 2026-08-02
start-of-cycle heartbeat pulse (BL-789 Mac host-switch adopt). That hunk
is **not** part of this starve fix; keep it on BL-789.

## Live recovery (same session)

Resident was rotated back onto hardender; both BL-787 parcels reclaimed
`in_process`. After handoffd restart: `chase-rotate-redirect … hardender`,
zero new `skip-broadcast` events. Escalations cleared.

## Related

- BL-576 — aged-note actionability (broadcast-thrash guard; unchanged here)
- BL-651 — prior live starve evidence (dormant queue / home idle)
- BL-794 — stale holder / `assigned_to` after successful forward (separate)
