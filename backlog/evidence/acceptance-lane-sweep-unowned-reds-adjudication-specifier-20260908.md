# Acceptance-lane sweep: unowned reds found at the BL-1485 mint, adjudication (specifier, 2026-09-08)

Measurements: `backlog/evidence/bl1318-acceptance-unowned-red-adjudication-specifier-20260908.md`
("Mint-time sweep: every handler that drives parse_config, both ways", main
`3dfa366fd9`). This file records the decisions that sweep left open, and how
they reached `main`.

## How this file came to be written by a successor session

The specifier session that ran the sweep minted BL-1485 (`c786acee5c`,
03:11Z), then drafted BL-1486 and BL-1489 with their feature files and had
their topic records stamped (`b697f36fb5` 03:20Z, `1216ae2151` 03:21Z). At
03:21:16Z `handoffd_supervisor.bb` fired `alarm-and-halt stalled` and its
`swarm-cleanup.sh` killed every role session, the specifier's pane included
(`.swarmforge/daemon/handoffd-failure-20260908T032116Z.log`; the daemon had
logged a `delivered` line 7 s earlier). The two drafts, this adjudication and
the standing-red register rows the drafts promise never reached a commit.
babysitterd respawned the pane and the successor session found the drafts
untracked at boot, checked them (hygiene gate, gherkin lint, IR-DRY) and
landed them unchanged in substance. The halt itself is the subject of
BL-1490/BL-1491/BL-1492 (intake `INTAKE-operator-question-1788834810204`).

## Decisions

| Red (lane) | Cause | Owner |
|---|---|---|
| BL-1052, BL-1218, BL-1320, BL-1418, BL-961, BL-628 features (acceptance) | handlers spawn the launcher with `process.env` spread in and a fixture root with no steward registry, so without the pane's `PACK_STAFFING_SKIP_GATE=1` the BL-1318 gate refuses the fixture's window line; green in a pane | BL-1486 (pin the override in the handler's own spawn, bl1324's shape) |
| BL-982 feature row 04 (acceptance) | the single-seat comparison diffs the whole roles.tsv line against a launcher pinned before `44d2d42591` added the reverse-hop column; red both ways since 2026-08-30 | BL-1489 (compare the fields the scenario names) |
| BL-939 feature, 4 of 4 (acceptance); `test_shipped_confs_no_coordinator_window.sh` "expected shipped conf missing entirely" (shell); `test_smoke_check_stabilize_two_pack.sh` case 01 (shell) | `swarmforge/profiles/` (8 files) was deleted on 2026-08-23 by `4695d31402` "chore: finish junk artifact removal after swarm cleanup", QA lane, no ticket; `.vscode/launch.json`, `smoke_check_stabilize_two_pack.sh`, the shipped-confs list, two features and Specification.MD §Swarm profiles still name the files. The smoke shell test's own fixture additionally declares a coordinator window BL-939 made the script reject (red since 2026-08-19) | BL-1487 (restore or retire, human ruling; every profile-path reference reconciled either way) |
| BL-1476 hardening-debt row, gate mutation (hardening) | cooldown skip on three files the land itself touched (`f0f54791c5`, 2026-09-08); BL-1476 closed 2026-09-08, so the row reads unowned and throttles the cap | BL-1488 (BL-1468's shape; not_before 2026-09-11) |

The shipped-confs test has two independent reds: the missing profile (seen
WITH the hatch, BL-1487) and the gate refusal (seen WITHOUT it, BL-1486
scenario 02). Its register row names BL-1487; BL-1486's scenario keeps the
gate half.

Register rows for every red above are added in the owner's own mint commit
so the register never reads them unowned. Reproduced by the successor
session on main `1216ae2151`: BL-939 `# fail 4` (ENOENT on the profile),
shipped-confs `FAIL: expected shipped conf missing entirely`, smoke shell
test `FAIL: 01`, `mutation_cooldown_gate.bb` on transcriptWalker.ts
`file_age_days 0.03 (cooldown: 3 days)`.
