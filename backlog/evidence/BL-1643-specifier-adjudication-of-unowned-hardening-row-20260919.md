# BL-1643 - specifier adjudication of the coordinator's unowned hardening-row note, 2026-09-19

Inbound: coordinator note 00_20260919T005216Z_009593 (priority 00):
"unowned hardening row BL-831 caps depth to 1; mint owner, BL-1638 shape".

## Facts at 02:0x local, main 66dc7a2e7d

- `backlog/hardening-debt-ledger.yaml` row: parcel BL-831, gate
  `stryker-mutation` (the discharge verb must match this spelling),
  file_set `extension/out/bridge/bubblePipelinePage.js`, detected and
  attempted 2026-09-18; blocker "dry-run ... did not complete within a
  300s wrapper timeout, concurrency 4, 16:14:23-16:19:23"; reason names
  the perTest dry run (114 mutants instrumented) that never got past
  "Starting initial test run" under load 11.2-14.3 on 20 cores with
  concurrent stryker/vitest workers from other worktrees, and the
  substituted targeted hardening (3 hand-authored unit tests, max CRAP
  6.00 on the three touched files, BL-113 Gherkin mutation 4/4 killed,
  acceptance 8/8, unit suite 10781/10782, DRY 0 clones).
- BL-831: landed cdeb8bdfdb (2026-09-19 00:39Z), closed 22c3f6f111
  (00:49Z, "Close BL-831: move to done"). Hardender pass evidence
  `backlog/evidence/BL-831-hardender-20260918.md` is NONE and lists the
  substituted coverage; the deferral lives in the ledger row, as designed.
- `standing_red_register_cli.bb .` at mint:
  rows 8 unowned 1
    UNOWNED hardening extension/out/bridge/bubblePipelinePage.js -> BL-831
    hardening extension/out/bridge/bubbleLiveUiHtml.js,extension/out/bridge/residentPaneLive.js -> BL-1638 owned
    hardening extension/out/bridge/bubblePipelinePage.js -> BL-831 UNOWNED
    oldest_age_days 1
  `effective_backlog_depth_cli.bb .` = 1.
- No scoped Stryker config for BL-831 on main or in the hardender
  worktree (`extension/vitest.bl831*` absent in both).
- File size: bubblePipelinePage.ts 97 lines.
- Cooldown: `mutation_cooldown_gate.bb . extension/src/bridge/bubblePipelinePage.ts`
  answers `skip-cooldown` (file_age_days 0.47, cooldown 1 day); last
  touch on main ba3522d794 (2026-09-18 14:47 local), so the window clears
  ~13:47Z on 2026-09-19; `not_before: 2026-09-20` as the first whole day.
- Host at mint: load 13.82/13.56/14.70, 21 vitest/stryker workers, 10/19
  GB memory - not a window to run in (the same shape the hardender met).

## Ruling

Mint BL-1643 in BL-1638's shape (defect, high, auto-approved,
`not_before: 2026-09-20` as cooldown arithmetic): owning the row lifts
the throttle at once (the register reads a paused or active ticket as an
owner); the run waits for the cooldown and a quiet host; a timeout is
recorded with the attempt verb and never discharged; every survivor names
an owner (2026-09-10 rule). The scoped config is created and committed in
the parcel. The register row naming BL-1643 is appended in the mint
commit. The coordinator is told the cap may be restored once this ticket
is on main.

Second row of this shape in two days (BL-775 -> BL-1638 yesterday): the
deferrals are the host's, not the parcels' - BL-1636 (/tmp census) and
BL-1633 (in-suite fork contention) are the causes on file.

By specifier.
