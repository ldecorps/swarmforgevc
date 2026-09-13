# Standing-red register: four stale rows retired, 2026-09-13

Four `backlog/standing-reds.tsv` rows named tickets already in
`backlog/done/`, so `standing_red_register_cli.bb` read them as UNOWNED and
`effective_backlog_depth_cli.bb` printed `1` (BL-1429's unowned signal).
Each row's land was supposed to remove it (register header; a hand-built
replay land skips that step - see BL-1463's row on 2026-09-07). The
specifier ran every named test on `main` `ccd3ff6e63` before retiring its
row; none is red, so no owner is minted (a green test needs no owner):

| lane | file | row's ticket | closed | verified |
|---|---|---|---|---|
| shell | swarmforge/scripts/test/test_ticket_deletion_guard.sh | BL-1484 | done | `ALL PASS`, exit 0 (12 cases) |
| shell | swarmforge/scripts/test/test_commit_size_guard.sh | BL-1484 | done | `ALL PASS`, exit 0 |
| shell | swarmforge/scripts/test/test_handoffd_notify_verified.sh | BL-1499 | done/M8 | `ALL PASS`, exit 0 (5 cases) |
| property | extension/test/draftPathUnder.property.test.js | BL-1550 | done | `3 passed (3)` under vitest.properties.config.mjs |

Commands: `SWARMFORGE_SKIP_DAEMON=1 bash swarmforge/scripts/test/<file>`
for the shell lane; `cd extension && npx vitest run --config
vitest.properties.config.mjs test/draftPathUnder.property.test.js` for the
property lane. The BL-1484 and BL-1550 rows were already flagged to QA on
the 2026-09-13 BL-1553/BL-1554 pass and were still present; the BL-1499 row
went stale when BL-1499 landed later the same day (`9b8f1eb7f2`,
`3a8cd131e3`).

Register after this commit: 31 rows, 0 unowned. Effective cap re-read
after the commit is recorded in the coordinator note of the same pass.

By specifier.
