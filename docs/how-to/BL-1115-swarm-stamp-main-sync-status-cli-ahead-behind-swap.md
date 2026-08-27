# Stamp-off: main_sync_status_cli ahead/behind swap (BL-1115)

BL-848 stamp-off for Cursor hotfix `a3bf11b533`. Green tests never write
`certified` / `waived` into the hotfix ledger — only a recorded human decision
does.

## What landed

`swarmforge/scripts/main_sync_status_cli.bb` counts with the same range and
binding as `handoffd.bb`:

```bash
git rev-list --left-right --count origin/main...main
# bind: [behind ahead]
```

`main...origin/main` inverts the labels and can leave step-0 gated on
`ff-only` after a successful BL-891 absorb (`behind` should be `0`).

## Operator check

```bash
bb swarmforge/scripts/main_sync_status_cli.bb <project-root>
```

After local `main` has absorbed `origin/main`, expect `behind: 0` and
`action: proceed` (or a clear of a tripped deadlock when `behind=0`) — never
inverted `ahead:0 behind:N`.

## Stamp-off posture

- Review confirms or refutes landed commit `a3bf11b533` only — do not
  redesign the CLI in this ticket.
- Ledger row for `a3bf11b533` stays `state: pending` until Approvals / human
  ledger decision (BL-848).
- Related surface: BL-1113 (deadlock breaker stamp); reconcile context in
  [BL-891](BL-891-master-main-reconcile-sweep.md).

## Bare origin/main rematch

Hitchhiked tips that stacked foreign actives must be recreated with
**BL-1115 paths only**. Hitchhike gate:

```bash
git diff --name-only origin/main...HEAD \
  | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8' \
  && echo FAIL || echo CLEAN
```

Stamp-off tips intentionally touch `backlog/hotfix-ledger.yaml` (pending row
only).

## Acceptance

`specs/features/BL-1115-swarm-stamp-main-sync-status-cli-ahead-behind-swap.feature`
