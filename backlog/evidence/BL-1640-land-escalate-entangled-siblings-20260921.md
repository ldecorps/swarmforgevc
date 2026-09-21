# BL-1640 — LAND_ESCALATE, entangled unlanded siblings, 2026-09-21

QA approved BL-1640 on its own merits (`backlog/evidence/BL-1640-QA-20260921.md`)
and separately bounced its batch sibling BL-1641
(`backlog/evidence/BL-1641-qa-bounce-20260921.md`). Landing BL-1640 alone is
blocked: its own tip is entangled with unlanded sibling work (BL-1241 shape,
QA.prompt).

`bb swarmforge/scripts/land_step_cli.bb BL-1640-a-finish-shift-sleep-runs-the-closing-ceremony-to-done HEAD`
(run after syncing `origin/main`) returns `LAND_ESCALATE`:

```
ENTANGLED_SIBLING BL-1458
ENTANGLED_SIBLING BL-1641
ENTANGLED_SIBLING BL-1671
```

- **BL-1671**: already landed on `origin/main` (`610b9121ee`..`a1883bb860`,
  including its `Close BL-1671: move to done`). This print is the known
  BL-1636 first-parent-walk blind spot for a merge-borne landed sibling -
  noted here, not itself blocking.
- **BL-1641**: genuinely unlanded - QA just bounced it (see above); expected
  to clear once the coder resends the corrected lineage and it lands.
- **BL-1458**: genuinely unlanded and the REAL blocker. QA bounced BL-1458
  earlier this session (`backlog/evidence/BL-1458-bounce-20260921.md`, a
  `tempDirTrapGuard` leak in a new hardener-authored test runner,
  `swarmforge/scripts/test/bl1458_instruct_documenter_briefing_test_runner.bb`).
  BL-1640's OWN hardener pass separately touched that same file as a
  bystander fix (`48476322ab`, "cut case 15's real wall-clock cost... fix a
  temp-dir-trap gap in a BL-1458 runner") - so BL-1640's tip carries a file
  that is attributed to (and only landable under) BL-1458, which has not
  landed. The replay attempt to build a BL-1640-only tip-pure commit is
  refused by `check_test_file_registration.sh` because a clean exclusion of
  BL-1458's own file leaves that guard unsatisfied for the file BL-1640's
  hardener DID touch.

This is a real dependency, not a QA mistake to route around by hand: BL-1640
cannot land clean until BL-1458 lands (or the two are otherwise
reconciled). Per QA.prompt's BL-1241 step 3, this is not a bounce to any
role - no role can unilaterally resolve a cross-ticket landing dependency.
Sent to the specifier for adjudication.

By QA.
