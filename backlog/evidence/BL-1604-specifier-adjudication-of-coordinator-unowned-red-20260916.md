# Coordinator unowned-red note (telegramFrontDeskBotCli, no register row) - specifier adjudication (2026-09-16 17:35Z)

Inbound: `00_20260916T172621Z_008830_from_coordinator_to_specifier`,
"URGENT cap=1: telegramFrontDeskBotCli unowned, BL-1595 exists, no reg row".

## What happened (read from git, not guessed)

- `standing_red_register_cli.bb .` at 17:30Z: 12 rows, `unowned` =
  `extension/test/telegramFrontDeskBotCli.property.test.js` (no row, ticket
  none). BL-1595 is in `backlog/active/`, mid-rework after an architect
  bounce (`BL-1595-architect-bounce-20260916.md` on the QA branch); its
  file is still red. The allowlist mirror row is still present.
- `git log -- backlog/standing-reds.tsv`: the last touch is `2c1c44e2cc`
  18:17 local, "BL-1548: tip-pure replay onto origin/main (BL-1241
  land-step remedy)". `git show 2c1c44e2cc -- backlog/standing-reds.tsv`:
  one deletion, BL-1595's row, nothing else. BL-1548's parcel (the
  launcher's SKIP_DAEMON audit line) has no reason to touch the register;
  the row went missing on the QA branch and the replay carried the file
  whole from the tip.
- No gate could catch it: BL-1595 is open and unbounced (not a BL-1375
  blocker), the register's touching commits on the branch are cleanly
  attributed (no BL-1544 ambiguity), and the tip content differs from
  origin/main by a removal whose owner is not the lander - a case no
  clause names. The two earlier losses today (BL-1589's tip carrying
  BL-1588's four rows; BL-1573's tips lacking the bl1280 allowlist row)
  were blocked by unrelated properties of those parcels.

## Remedy

1. Restored the row on main this commit, byte-identical from
   `05e7ee0395:backlog/standing-reds.tsv` (the register is the
   specifier's file; the row's owner is open). `standing_red_register_cli.bb`
   after the restore: 12 rows, `unowned: []`. The cap returns to its
   configured value on the coordinator's next tick.
2. Minted **BL-1604** (`type: defect`, `severity: high`, epic
   swarm-reliability): the land step restores from origin/main every
   register or allowlist row owned by an open ticket other than the
   landing one that the replay tree lacks, prints each restoration, and
   still lets the landing ticket's own rows (and a closed ticket's rows)
   leave. Two scenarios on a git fixture, two invariants.

## Recorded, not ticketed

- Why the row went missing on the QA branch is not traced; `git log -S`
  on the register over the QA branch would say. Three losses of shared
  registry rows on branches in one day (register x2, allowlist x1) say
  the branches lose rows routinely; BL-1576 guards one merge shape at
  send time. BL-1604 makes the loss harmless at land, which is the cheap
  and sufficient place.
