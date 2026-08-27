# Guard master checkout against bare and collapsed tips (BL-1123)

## Incident (2026-08-25)

The master checkout flipped `core.bare=true` (twice the same morning).
`git rev-parse --is-inside-work-tree` became false, `ready_for_next.sh`
printed "Cannot find SwarmForge project root", and roles could not commit
normally. Concurrently `main` tip collapsed to tiny trees (1–4 files).
Coordinator restored a full tip and `bare=false`; this ticket makes
recurrence self-healing (or loudly blocked).

## What changed

| Piece | Role |
| --- | --- |
| `master_checkout_integrity_lib.bb` | Heal `core.bare`; tip-floor verdict (default floor 500) |
| `master_checkout_integrity_cli.bb` | Thin CLI — JSON line; exit 0 only when bare ok + tip allowed |
| `handoffd.bb` | Unconditional `master-checkout-integrity-sweep!` each cadence |

## Operator runbook

### Symptoms

- `Cannot find SwarmForge project root` / `not a git work tree` on master
- `git config --bool core.bare` → `true`
- `git ls-tree -r --name-only HEAD | wc -l` far below a full tip (~thousands)

### Heal / check (scratch fixtures only for `--no-heal` experiments)

```bash
bb swarmforge/scripts/master_checkout_integrity_cli.bb <project-root>
# optional: --tip-floor N   --no-heal
```

Exit `0`: bare is a work tree and HEAD meets the tip floor. Exit `1`: alarm
JSON on stdout (`bare` / `tip` / `alarms`). Prefer the daemon sweep over
hand-editing `.git/config` while handoffd is up.

### Do not

- Push abandoned spam tips from the incident reflog
- `reset --hard` away role worktrees to "fix" bare
- Mute mid-commit drift WARN (that is BL-1122)

Acceptance:
`specs/features/BL-1123-guard-master-checkout-against-bare-and-collapsed-tip.feature`
