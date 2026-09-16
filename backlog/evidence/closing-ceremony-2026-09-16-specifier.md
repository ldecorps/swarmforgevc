# Closing ceremony — shift 2026-09-16 (specifier lean pass, BL-820)

Packet: `.swarmforge/lean/ceremony/2026-09-16.json`, `deliveredAt`
2026-09-16T00:00:00Z, folded 08:10 local, read via the coordinator's
priority-00 note (`00_20260916T071047Z_008556`), resumed from
`in_process` by a fresh specifier session. The run was `pending` on
arrival (`outcome: null`), so the outcome is recorded in the store.

**Outcome recorded: `process_ticket`, ref BL-1590** (`backlog/paused/`,
`human_approval: pending`, epic `lean-aware-coordinator`, `severity:
medium`). A second mint of the same pass, outside the packet, is
**BL-1591**, the BL-848 stamp of hotfix a27d082c2d (see below).

## What the packet showed

Fifteen tickets closed in the shift (BL-1574..1581, BL-1583..1587,
BL-1509, BL-1558, BL-1483). Path taken cleaner, architect, hardender,
documenter, QA, coder. Dwell hotspots QA 4645170ms, hardender 3772261ms,
coder 2738090ms. Bounces: `behavior` x1 (BL-1587, 0a6d9b6053, architect
blamed cleaner). Stalls: cleaner chase x6, coder chase x4, QA nudge x3,
architect chase x2, documenter chase x1, QA chase x1. Hypotheses: QA
dwell; the `behavior` class; "6 chase(s) in cleaner". Quality dial: lower
x1 (hardender, stage_transition), raise x5 citing `stalls` (architect,
cleaner, coder, documenter, QA; cleaner also the bounce) - advisory, the
coordinator's half. Determinism candidates `pass-bounce-evidence`
(0.026) and `backlog-promotion` (0.205).

## The signal I acted on - the chase fold -> BL-1590

The "N chase(s) in cleaner - chase pattern" hypothesis has been the
packet's stall line on 2026-09-13 (7), 09-14 (10), 09-15 (4) and today
(6), and the specifier dismissed it each time (09-13 "Mono-router
rotation waits ... Known shape"; 09-15 "Rotation boot latency; no
ticket"). This pass measured why. Over the shift window
2026-09-15T09:00Z..2026-09-16T08:00Z:

- chase rows (`.swarmforge/telemetry/chaser-2026-09.jsonl`,
  `"type":"chase"`): cleaner 17, specifier 8, coder 7, QA 6, documenter
  5, architect 4, hardender 3 = 50;
- rotation rows (`rotation-2026-09.jsonl`, `"reason":"rotate"`): cleaner
  13, architect 5, specifier 5, QA 4, hardender 4, documenter 3, coder 2,
  coordinator 1;
- joined (chase row -> a rotation row whose `to` equals the chased role
  and whose `at` is within 2 s): **26 of 50** - cleaner 8, specifier 5,
  architect 4, QA 4, documenter 3, coder 2. Examples to the millisecond:
  chase cleaner 04:07:11.630Z / rotate coder->cleaner 04:07:11.818Z;
  chase 05:12:14.008Z / rotate 05:12:14.187Z; chase 21:55:59.944Z /
  rotate 21:56:00.165Z; QA chase 23:37:28.949Z / rotate 23:37:29.799Z.

The join script (python3, stdlib only):

```
lo,hi = 2026-09-15T09:00Z, 2026-09-16T08:00Z
ch = chase rows in [lo,hi); ro = rotation rows in [lo,hi)
for c in ch: hit = any(r for r in ro if r.to == c.role and |r.at - c.at| <= 2 s)
```

Four of the cleaner's eleven chase EVENTS sat on QA merge-up broadcast
notes (`00_20260915T234650Z_002770`, `00_20260916T031933Z_002776` x2,
`00_20260916T043741Z_002778`) and one on a hardender->cleaner reverse-hop
copy (`00_20260915T204609Z_001336`); none was work the cleaner could have
taken faster. `chase-poke-and-notify!`'s `:rotate` mode is the daemon
rotating the resident AS the chased role - on a router pack that is how a
dormant role's mail gets a seat whenever the forwarding seat did not
rotate itself there (BL-1557 covers one recipient). The chase row does
not say which poke advanced it (`apply-inbox-item-action!`,
`chase_sweep_lib.bb` ~463, keys on BL-1505's `:attempted` only);
`leanLedgerComposeStall.ts` folds every `chase` row into a stall;
`closingCeremony.ts` builds the hypothesis and the `raise` cites from
them. The rotation is already its own instrument (BL-594's series), so
the fold counts one event twice and charges the router's placement to the
chased role's quality.

Minted **BL-1590** (`type: defect`, `severity: medium`, epic
`lean-aware-coordinator`): the chase row names its poke (`wake` |
`rotate`), a row naming a rotation composes no stall, a row naming a wake
or naming no poke composes exactly today's stall; the ladder,
chaseTimeoutSeconds, BL-098's chase rate and the dial arithmetic are out
of scope. Three scenarios (two outlines x3, one census-pinned shell run).
Sibling by shape: BL-1551 (respawn rung, same adapter), no overlap. Epic
BL-818 `decomposes_into` gains the id. Feature linted; IR-DRY run and
adjudicated below.

## The second mint - hotfix a27d082c2d -> BL-1591

`backlog/hotfix-ledger.yaml` carried an uncommitted, sweep-appended
`pending` row for a27d082c2d ("Night-closing-ceremony: documenter gets an
ephemeral session when rotate is refused", operator, 07:58 BST, trailer
`Hotfix-Certification: pending`) with no stamp ticket and no coordinator
note yet in my mailbox. Grepped the SHA across every backlog area first
(no stamp existed). Minted **BL-1591** on the BL-1549/BL-1563 stamp
shape: five scenarios (the real vitest file with its three test names
pinned, the real shell test with 01-04 and the manifest row pinned, a
four-row CLI contract outline, a CLI-written marker torn down by the
daemon's existing sweep, ledger decision left to the human) plus six
recorded probes: `stdio: 'pipe'` swallowing the CLI's status; the
pre-hotfix coordinator note still sent after a spawn; a possible race
between the spawn and `instructBriefing` against `consult-teardown-
sweep!`'s idle-and-empty predicate; `env-args []` vs the daemon's
openrouter args; worktrees carrying the hotfix at mint (main, QA,
documenter only); the banned-API debt count. Ledger row linked with
`hotfix_ledger_update.bb --link` and committed with the mint. Runner
budgets measured on this host before minting (BL-1541): vitest file
1.4 s, shell test 0.3 s.

## Signals I looked at and did not act on

- **QA dwell 77 min** across fifteen closures, about five minutes each,
  each a full-suite sweep. Per-parcel minutes; no ticket (same reading as
  09-15; BL-1565/BL-1566 own the hold-starvation half).
- **`behavior` x1** - BL-1587's cleaner evidence committed under
  `extension/backlog/evidence/` (cwd in `extension/`). The architect's
  own inventory names the class and its owner, **BL-1552** (paused, 17
  commits by four roles since 09-07, seven strays still tracked). Already
  owned; not re-minted. The coordinator may weigh BL-1552's recurrence
  when it next promotes.
- **`qualityRecommendations`** lower x1 / raise x5: advisory, and five of
  the six rows rest on the fold BL-1590 corrects.
- **Determinism candidates** `pass-bounce-evidence` (0.026),
  `backlog-promotion` (0.205): still no open `ritual_class:` declarant
  (grep over paused/active/hold found none). Neither mint scripts either
  ritual, so neither declares a class - a false declaration would only
  hide it. Not ticketed, same reasoning as 09-08..09-15; expect both again.
- **Uncommitted edits on the shared checkout at boot**: the hotfix-ledger
  row (now committed with BL-1591's link) and the tracked
  `swarmforge/runtime/handoff-draft.txt` deleted (consumed by a send;
  recreated by this pass's own note). Surfaced for the coordinator's
  step 0; nothing swept.
- **Seat check**: one live specifier (pid 2924 in the swarmforge-coder
  pane, no dedicated specifier session) - not the 09-14/09-15 two-seat
  shape.

By specifier.
