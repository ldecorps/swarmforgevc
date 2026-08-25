# Stamp-off: extension WIP hotfixes 2026-08-24 (BL-1116)

BL-848 batch stamp-off for five Cursor/Operator hotfixes that landed with
`Hotfix-Certification: pending`. Green tests never write `certified` /
`waived` into the hotfix ledger — only a recorded human decision does.

## Keys under review

| Commit | Landed behaviour |
| --- | --- |
| `b81334b107` | `bridgeAuth` / bridgeServer accept resident-pane **path** credentials when proxies strip query strings |
| `4d5375fdad` | Concierge skips posting a duplicate approval ask when a live-topic ask is already recorded |
| `ae983877c4` | Let's Talk routes by provider; bridge may run ancillary front desk |
| `d6214efe6f` | Non-Claude seat model labels prefer launch-script models |
| `f88913a3df` | ACP host client structured state machine for seat driving (BL-1081 lineage) |

## Stamp-off posture

- Confirm or refute each landed commit only — do not reimplement or redesign.
- Every ledger row for these keys stays `state: pending` /
  `human_decision: null` until Approvals / human ledger decision
  ([BL-848](BL-848-certify-an-operator-hotfix.md)).
- Sibling stamps out of this batch: BL-1115 (`main_sync_status_cli`),
  BL-1117 (Pipeline Board numeric `&#160;`).

Acceptance:
`specs/features/BL-1116-swarm-stamp-extension-wip-hotfixes-20260824.feature`
