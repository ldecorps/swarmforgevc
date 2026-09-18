# BL-1638 - specifier adjudication of the coordinator's unowned hardening-row note, 2026-09-18

Inbound: coordinator note 00_20260918T151816Z_009547 (priority 00):
"BL-775 hardening-debt row unowned - throttles cap to 1, mint owner".

## Facts at 16:2x local, main d9ab75a47f

- `backlog/hardening-debt-ledger.yaml` row: parcel BL-775, gate
  `stryker-mutation` (the older rows say `mutation` - the discharge verb
  must match this spelling), file_set
  `extension/out/bridge/bubbleLiveUiHtml.js,extension/out/bridge/residentPaneLive.js`,
  detected and attempted 2026-09-18; blocker "dry-run timeout (5min) at
  concurrency 4 ... 15:03:27-15:08:33"; reason names the twice-timed-out
  perTest dry run under load 11.5-25.2 on 20 cores, swap 1.7-1.8 GiB, 8+
  concurrent workers, and a plain coverage run that died with
  ERR_IPC_CHANNEL_CLOSED after a WSL-captured node abort (signal 6).
- BL-775: landed c3395108d8 (16:15), closed 7e49a69087 (16:16),
  `backlog/done/M8/`. Its hardender pass evidence is NONE for defects; the
  deferral lives only in the ledger row, as designed (BL-942: a gate that
  ran records no row).
- `standing_red_register_cli.bb .`: 7 rows, 1 unowned -
  `hardening: residentPaneLive.js -> BL-775`. The other six are owned
  (BL-1634, BL-1635). Every other ledger row is discharged (BL-1441,
  BL-1468, BL-1488).
- The parcel's scoped config `extension/vitest.bl775.stryker.config.mjs`
  is NOT on main (hardender worktree only).
- File sizes: bubbleLiveUiHtml.ts 18 lines, residentPaneLive.ts 416.
- Cooldown: both files touched on main by the 2026-09-18 land; the
  3-day gate clears 2026-09-21.
- Host at mint: load 13.16/12.83/14.29, 16 vitest/stryker workers, 10/19
  GB memory, 1 GB swap - not a window to run in.

## Ruling

Mint BL-1638 in BL-1488's shape (defect, high, auto-approved,
`not_before: 2026-09-21` as cooldown arithmetic from the land date):
owning the row lifts the throttle at once (the register reads a paused or
active ticket as an owner); the run waits for the cooldown and a quiet
host; a timeout is recorded with the attempt verb and never discharged;
every survivor names an owner (2026-09-10 rule). The config is recreated
and committed in the parcel. The coordinator is told the cap may be
restored once this ticket is on main.

By specifier.
