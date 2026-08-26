# Stamp-off: babysitterd heartbeat + cursor-forge pack parse (BL-1136)

BL-848 stamp-off for Cursor hotfix `fbf6f1a909` (`Hotfix-Certification:
pending`). Green tests never write `certified` / `waived` into the hotfix
ledger — only a recorded human decision does.

## Landed behaviour under review

| Path | Confirm |
| --- | --- |
| `swarmforge/scripts/babysitterd.sh` | `pulse_heartbeat` at process start and each tick start+end (BL-789 shape). Product owner remains **BL-1133** — this stamp dual-cites it and does not rewrite that contract. |
| `swarmforge/packs/cursor-forge.conf` | Invalid `config rotation standing` removed (parser only accepts `sequential` / `router`); standing full-forge panes omit the rotation key so `./swarm --pack cursor-forge` launches. |

## Stamp-off posture

- Confirm or refute landed commit `fbf6f1a909` only — do not reimplement.
- Ledger stays `state: pending` / `human_decision: null` until Approvals /
  human decision ([BL-848](BL-848-certify-an-operator-hotfix.md)).

Acceptance:
`specs/features/BL-1136-swarm-stamp-babysitterd-cursor-forge-fbf6f1a909.feature`
