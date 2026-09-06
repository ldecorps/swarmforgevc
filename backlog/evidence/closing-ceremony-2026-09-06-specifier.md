# Closing ceremony 2026-09-06 — specifier lean pass (BL-820)

Packet: `.swarmforge/lean/ceremony/2026-09-06.json`. Outcome recorded:
`spec_gate_tweak`, ref **BL-1408**. Also this pass: the BL-1362 prompt half
landed (`a8897313f0`), BL-1443 minted (`76dc102776`).

The shift was one ticket, BL-1440, through all six stages: bounced once by
QA at 01:21 (`5d6a055835`, class `unit`), fixed by the coder at 01:31,
re-walked five stages, landed 01:46, closed 01:53. BL-1441 promoted at 01:53.

## Hypothesis 2 — one `unit` bounce: the fifth hand edit of the commit-guard list

- QA's D1 (`backlog/evidence/BL-1440-bounce-20260906.md`): BL-1440 added
  `check_constitution_doc_citations.sh` to `run_commit_guards.sh` Tier 1;
  `INDEX_GUARDS` in `bl1252CommitGuardAggregationInvariants.property.test.js`
  is hand-enumerated and lacked it, so three properties failed. The file's
  own comment names this failure mode. Coder fix: add the entry by hand.
- Same shape, same list family: BL-1385 and BL-1395 (09-04) left both copies
  stale; BL-1428 (09-05) hand-patched both and wrote the discipline down;
  BL-1440 (09-06) missed one copy and bounced. BL-1398 and BL-1401 fixed two
  OTHER fixtures of this shape by deriving from the runner.
- **BL-1408** (paused, minted 09-05) already owns the sweep of the remaining
  three copies. It sat at `severity: medium`, priority 12. Verified this
  pass: `bash swarmforge/scripts/test/test_run_commit_guards.sh` is RED on
  main today (case 01, status 127: `ALL_GUARDS` lacks BL-1440's guard) — a
  `standing` suite row, red since 09-04, with no register row.
- **Tweak** (`59220af7cf`): BL-1408 re-classed `high` under the 2026-09-05
  standing-red rule (a ticket that already owns a red is re-classed high);
  `backlog/standing-reds.tsv` gains the row
  `shell  swarmforge/scripts/test/test_run_commit_guards.sh  BL-1408  2026-09-04`;
  the description gains a dated "Since mint" section naming both 09-06
  incidents and the row's removal at landing. Register reader: 5 rows, none
  unowned. Scenarios, invariants, approval unchanged. BL-1408 now rides the
  expedite lane; it is orthogonal to BL-1441 (active).
- Cost of the miss: bounce 00:21Z → fix 00:31Z → second cleaner, architect,
  hardener, documenter and QA passes to 00:46Z; ~25 min across five roles.

## Hypothesis 1 — QA longest dwell (21.5 min): explained, no change

Two QA passes on BL-1440: 15.2 min (full unit suite 610 files, full property
suite ~143 s, acceptance, scratch-clone fixture, then the bounce with its
revert and `record-bounce`) and 6.3 min (re-review after the fix). The
`qualityRecommendations` dials are the coordinator's half. BL-667 owns the
post-QA choreography cost.

## Determinism candidates (BL-1365)

- **`pass-bounce-evidence`** (4347 commits, dominance 0.008): the ritual
  has a writer — BL-1362 shipped `extension/out/tools/record-review-evidence.js`
  on 2026-09-04 (`be2f7583fe`) — and no role prompt named it; every subject
  this shift was still hand-composed ("BL-1440: hardener pass 2 - bounce
  fix confirmed, no new defect"). BL-1362's own How, last bullet: "prompt
  changes that make it the standard route are the specifier's to land" — a
  BL-798-shape miss, mine. **Landed** (`a8897313f0`): one section in cleaner,
  architect, hardender, documenter and QA: the tool writes and commits the
  verdict file (NONE or D1..Dn) and prints the commit to forward; anything
  beyond the verdict goes under `## Detail` in the same file with the fixed
  subject `<BL-id>: <role> review pass evidence (detail)`. No open ticket
  declares `ritual_class: pass-bounce-evidence`, so the class will be offered
  again until dominance rises; that is the fail-toward-firing posture. Expect
  the 45-day figure to move only as new passes use the tool.
- **`backlog-promotion`** (dominance 0.18): `no_change`. The class is
  `backlog/active/` path edits and is mixed by construction (its own code
  comment says so): 541 "Promote BL-N" and 401 "Close BL-N" (a close moves
  the file out of active/) are both scripted, plus 76 specifier promotions,
  29 expedite records, and in-flight amendments that are judgment, not
  ritual. Also inflated by 112 fixture commits ("seed" / "fixture: initial",
  2026-08-26/27, e.g. `6f264010bb`) that BL-1200's incident let into main's
  history via the BL-1190 cleaner merge `2861d83ef8`; they leave the window
  by 2026-10-11. No hand ritual to script.
- **`backlog-closure`** (dominance 0.47, ceiling 0.5): `no_change`. 484 of
  887 are "Close BL-N: move to done" in four subject variants of the same
  scripted close (bare, "By coordinator.", "(QA-approved landed-but-open)",
  "/M8"); the rest are merge-ups, deprecator retirements and specifier
  retires — judgment acts. Unifying the four variants would lift the number
  over the ceiling but changes nothing a human does.

## Also surfaced by QA, weighed here

- `bl874PortableTimeInvariants` failed once with ENOENT on a bl868 transient
  fixture: a listing/read race between two property tests in the concurrent
  pool, mechanism verified in `propertyLaneFixtureRunner.js` (writes and
  removes `bl868-fixture-*.property.test.js` in `extension/test/`) and bl874's
  walk. Untracked (BL-1410 and BL-1407 do not cover it). **Minted BL-1443**
  (`76dc102776`, medium, approval pending): a shared tolerant walk, bl874 and
  the other eight inline walkers routed through it, no inline walk left.
- `bl1352EscalationVisibilityInvariants` failed once under host load and
  passed twice isolated: no mechanism in evidence; not minted. BL-1407 closed
  the load-flake class; if it recurs, it is an `unowned-red` note.

## Notes for the coordinator

BL-1443 is ready in `backlog/paused/` (approval pending). BL-1408 is now
`severity: high` with a register row: the expedite lane promotes it ahead of
non-expedited work when the cap allows (cap 1 today, BL-1441 active). The
register's oldest row is 18 days (BL-1441's hardening rows), so the age
throttle is unchanged by this pass.

By specifier.
