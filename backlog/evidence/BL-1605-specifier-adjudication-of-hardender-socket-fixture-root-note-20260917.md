# BL-1605 — specifier adjudication of the hardender's "unowned-red socket-fixture-root" note, 2026-09-17

Inbound: hardender `note` 001371 to the specifier, priority 00, created
2026-09-17T06:10:41Z: "unowned-red BL-1605 socket-fixture-root, see
BL-1605-hardender-followup-20260917". Hardender evidence (its tree,
93513e47b6): `backlog/evidence/BL-1605-hardender-socket-fixture-root-followup-20260917.md`.
Adjudicated 06:16Z-06:30Z from the master checkout.

## The finding (verified in the documenter's tree, BL-1605's forwarded tip 073a34b5e1)

`specs/pipeline/steps/bl1605NoReverseCopyToForwardRecipientSteps.js`:

```
44:  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1605-'));
73:  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
```

`extension/test/socketFixtureShortRootGuard.test.js` (BL-948) flags exactly
this shape - a socket-building step file rooted at `os.tmpdir()` - and its
failure text names the remedy: `lib/socketFixtureRoot.js`'s
`mkSocketFixtureRoot` (`specs/pipeline/steps/lib/socketFixtureRoot.js:70`,
on main; BL-1290 landed the same swap for the two older offenders). The
hardender found it running the standing whole-tree guards for the BL-1610
parcel and records that its own BL-1605 pass on 2026-09-16 missed it.

## Not an unowned red - BL-1605 owns its own parcel's defect

- The guard is GREEN on main: `cd extension && npx vitest run
  test/socketFixtureShortRootGuard.test.js` at 2130e3f375 -> 16 passed
  (07:20 local). The handler does not exist on main.
- The red rides every tree that carries BL-1605's parcel:

  | parcel | forwarded commit | carries the handler | where now |
  |---|---|---|---|
  | BL-1605 | 073a34b5e1 | yes | QA new/ (001330, 06:07Z) |
  | BL-1599 | 6ad1d3f616 | yes (the documenter's one branch carried it in) | QA new/ (001332, 06:09Z) |
  | BL-1608 | 8dc0efdb00 | no | QA in_process (001329) |
  | BL-1607 | 598af6a4c7 | no | QA new/ (001331) |

  QA's own tree (4b4b7762bf) does not carry it yet; it will once QA merges
  001330, and then every later parcel's unit lane is red on this guard
  until BL-1605's fix lands.
- Owner: BL-1605 itself, active, `severity: high` already. The defect is
  in the parcel's own step handler - coder domain (Article 4.3). No new
  ticket is minted, nothing is reclassed.

## Disposition

1. **Routing**: QA holds BL-1605 (001330). Note (priority 00) to QA: bounce
   BL-1605 to the coder with this defect in the inventory rather than
   approving; note to the coder that the rebuild is coming and what it is
   (the `mkSocketFixtureRoot` swap at line 44; the socket write at line 73
   stays). The hardender is owed nothing - its evidence already records the
   miss.
2. **Register row** (`backlog/standing-reds.tsv`, lane `unit`, owner
   BL-1605, first_seen 2026-09-17), added in this commit so QA's Article 4.2
   check reads the red as OWNED on BL-1599's parcel - and on QA's own tree
   after it merges 001330 - instead of holding the parcel and noting the
   specifier (the BL-1555/BL-1564 starvation shape, no resume trigger). The
   row says plainly that main is green and where the red actually rides;
   the register's purpose is a red tolerated while its fix is in flight, and
   that is this. Register invariant 2: the row leaves in the SAME land that
   turns the guard green - BL-1605's own fix commit removes it. A row that
   survives BL-1605's close reads unowned and throttles intake to 1
   (BL-1429); this is written into BL-1605's `notes:` for the coder and QA.
3. **BL-1599's approval must not carry BL-1605's handler onto main** - one
   ticket's approval authorizes only its own paths (workflow "An Approval
   Authorizes Only Its Ticket's Work"; BL-1276 task scope). If QA's land
   replays the tip whole and the handler does reach main, the register row
   above is then literally true and BL-1605's land still removes it.
4. BL-1605 `notes:` amended (bookkeeping, merges - BL-1391). Scenarios,
   invariants and `human_approval` unchanged: nothing about the contract
   moves, only the fixture root inside the handler.

By specifier.
