# Consolidation sweep over paused/pending tickets - 2026-09-21 (specifier)

**Ask.** Coordinator note (priority 00, 2026-09-21 08:22Z): "Human ask: run
this mornings consolidation sweep over paused/pending tickets." Run under
the Consolidation Authority (specifier.prompt, BL-680) and the 2026-09-17
operator directive recorded in `backlog/STEERING.md` ("The idea is to reduce
the number of tickets as they are very often quite similar"), bound by
Article 5.3 (no consolidation drops a human sentence).

**Population.** `backlog/paused/`: 104 tickets - 45 `type: epic` trackers
(not consolidation candidates; a dead tracker is Article 3.6 work, none
found dead this pass) and 59 non-epic tickets; 8 of them
`human_approval: pending` (BL-1458 re-pended, BL-1640 ruled A this morning,
BL-1641, BL-1644, BL-1658, BL-1659, BL-1665, BL-1669). `backlog/hold/`
empty. Inventory built with a script over id/type/severity/epic/approval/
priority/mutation_cost/depends_on/mint date/title/acceptance and read as
one batch, then grouped into twelve clusters by root cause or fix shape.
Prior sweeps' recorded non-merges were honoured, not re-litigated
(09-18: BL-1619/BL-1625 different substrate; 09-20: BL-1665/BL-1666
production vs test lane, BL-1658/BL-1659 different shapes, BL-1667/BL-1669
one file in declared order, BL-1629/1630/1631 orthogonal).

## Merges (N:1), five

| Absorbed | Into | Why one ticket |
|---|---|---|
| BL-1552 nested-backlog commit guard | BL-1603 evidence writer resolves repo root | Same root cause (record-review-evidence.js resolves `backlog/evidence` against cwd), same stray files (BL-1552 counted 3 on 09-13, BL-1603 counted 6 on 09-16 - the later census is kept, BL-1552's `-summary` name kept for the differing-twin case), one outcome: evidence never lands outside `backlog/evidence/`. Two parcels would each have moved the same files. Guard becomes the backstop half. Invariants 1+1=2. Envelope low -> medium. |
| BL-1590 chase-rotate is not a stall | BL-1551 skipped respawn is not a respawn | Same adapter map, same `apply-inbox-item-action!`, same `CHASER_ATTENTION_SIGNAL_TYPES` array, same `leanLedgerComposeStall.ts`, same BL-819 docs paragraph, one rung apart; BL-1590 named BL-1551 as its sibling by shape. Two parcels would have edited the same function and the same array concurrently. Invariants 1+1=2. |
| BL-889 harness refuses missing fixture root | BL-1517 project-root argument is a repository or refused | Same defect class (absent/invalid root silently resolves against cwd), same fix shape (one shared check at each entry point, refuse before the first write); BL-1517 already said "a follow-up can adopt the lib elsewhere" - BL-889's three harnesses are that follow-up. BL-889's `.feature.draft` converted to live scenarios 04-06 of BL-1517 (the 2026-08-30 draft-pointer trap closed). Two strictness levels stated (`:repository` for CLIs, `:directory` for a harness whose fixture is not a git checkout - `dispatch_gap_sweep_harness.bb` already runs `git -C <root> rev-parse`, the other two are the coder's call). Invariants 1+2=3 (cap). |
| BL-1521 negotiation Telegram survivors | BL-1520 telegramTopicDecisions survivors | Identical fix shape, same source rule_proposal, same census file, same epic, same evidence structure; 26+15=41 mutants over three small files is one sitting by the 2026-09-10 sizing rule (~60 per sitting). One Stryker run scoped to three compiled files. Invariant merged to one. |
| BL-1591 stamp of a27d082c2d (ceremony consult_spawn_cli.bb) | BL-1549 stamp of 5bdf93beed (daemon consult session) | One mechanism (spawn the target's own roles.tsv session on a refused rotate, marker, one teardown sweep), two spawners (the CLI is "deliberately a copy" of the daemon's), one fake-tmux fixture; BL-1591's scenario 04 already reused BL-1549's handler. Ledger row a27d082c2d re-linked to BL-1549 (`hotfix_ledger_update.bb --link`); the human still decides per commit. Invariant merged to one. Envelope low -> medium (9 scenarios, review-only). |

**Mechanics per merge.** Absorber YAML: title, mutation/envelope comments,
`required_wiring` (consumer anchors carried: BL-1552's `run_guard` line in
`run_commit_guards.sh`; BL-889's per-harness `System/exit` anchors replaced
by `project_root_arg_lib.bb` sourcing anchors, which only match with the
fix), `approval_context` (CONSOLIDATED paragraph carrying every FIRM line of
the absorbed ticket), `invariants`, `description` (absorbed sections
verbatim or condensed with every fact kept), `out_of_scope`,
`qa_e2e_procedure`, `source` (absorbed `source:` blocks carried verbatim,
including the two commit-message quotations), `notes` (consolidation
record). Absorber feature file rewritten with the absorbed scenarios folded
in under the absorber's id and stable indexes (Backgrounds that would have
changed a scenario's meaning were dissolved into per-scenario Givens).
Absorbed ticket: `status: superseded`, `closed_as: superseded-by-<id>`,
RETIRED paragraph first in `notes:`, moved to `backlog/done/M8/`
(precedent BL-1628, 2026-09-18); its feature file left in place as a
scenario-less tombstone naming the absorber - NOT deleted (see "Why no
deletion" below). Epic trackers
BL-541, BL-818, BL-1519 re-pointed in `decomposes_into` with a note;
BL-539 noted only (its list stops at BL-1110). `backlog/topics/<id>.json`
records left as history. BL-1622 and BL-1644 name BL-1591 as a precedent -
history, left.

**Approval.** Every absorber and every absorbed ticket was
`human_approval: approved` (BL-1552 by direct chat instruction 09-13;
BL-1590 09-16; BL-889 08-14; BL-1521 09-10; BL-1591 09-16). Nothing
unapproved was added to any absorber, so approval stands - no re-pend
(BL-1455: a re-pend would post no fresh ask anyway).

**Article 5.3.** No absorbed ticket quoted an operator sentence. BL-889's
and BL-1603's sources quote agents (a hardender rule_proposal, an architect
rule_proposal) and BL-1591's quotes a commit message; all carried verbatim.

## Reasoned non-merges

- **BL-1531 / BL-1532** (approval ask explains options; typed approve by
  letter): one human directive, deliberately split 1:2 on 09-11 with a
  `depends_on`. Merged invariants would be 3+2=5, over the cap of 3 - the
  cap is the INVEST Small signal, so not merged. The dependency already
  serialises them.
- **BL-1458 / BL-1640 / BL-1641** (briefing trigger author; sleep-path
  ceremony runs to done; deadline produces a briefing): one delivery
  chain, three mechanisms (fallback trigger + host nudge retirement;
  finish-shift loop + sleep-relative deadlines; deadline landing/compose),
  each already `slice_size_envelope: medium`; BL-1640/1641 were split from
  one intake on 09-19 with rulings asked separately (BL-1640 ruled A this
  morning, BL-1641 still pending). Not merged.
- **BL-1347 / BL-1355** (unanswered role question escalates; clearing a
  slot announces closure): both BL-772 slice D/E, different stores and
  languages (concierge stale-ask sweep in TS vs `role_ask.bb`'s resolve
  leg), opposite directions. Not merged.
- **BL-1561 / BL-1562** (heal never rewrites a data token; every nudge
  names the helper path): siblings of BL-1560, different files and
  mechanisms (a parser narrowing in `tool_miss_heal_lib.bb` vs string
  constants in `agent_runtime_lib.bb` and friends); BL-1562 is low. Not
  merged.
- **Hotfix stamps BL-1504, BL-1506, BL-1507, BL-1508, BL-1557, BL-1622,
  BL-1644**: each reviews one distinct landed diff of a distinct mechanism
  (wake dedup; landed auto-close; b.ai base; respawn bootstrap; forward
  rotate; withoutEmbeddedSource; cron PATH). A stamp merge is justified
  only when two rows are one mechanism (BL-1549/BL-1591 above). Not merged.
- **BL-1516** (fixture never reaches the live checkout) vs BL-1517/BL-889:
  fixture hygiene, a probe placeholder, a suite census and 13 deletions -
  a different shape from a root-argument check and already a full sitting.
  Not merged.
- **BL-1467** (re-point keeps QA bookkeeping): premise re-checked against
  BL-1650 (done, the land step's stray handling) - `post-land-repoint!`
  still resets to origin/main with no re-application; stands alone.
- **BL-1520 / BL-1523 / BL-1669** (larger first-run survivor files): 134
  and 106 mutants each, over a sitting on their own; not merged into
  BL-1520.
- **first-run debt BL-1638** (deferred-gate discharge) vs BL-1519's chores:
  different shape (run the deferred gate vs kill named survivors).
- **Product feature slices** (BL-101, BL-548, BL-553, BL-555, BL-569,
  BL-793, BL-836-838, BL-842-843, BL-940, BL-1270) and the singletons
  (BL-472, BL-750, BL-974, BL-987, BL-1282, BL-1331, BL-1453, BL-1456,
  BL-1596, BL-1597, BL-1619, BL-1625, BL-1629, BL-1638, BL-1655, BL-1658,
  BL-1659, BL-1665, BL-1666): read by title and epic; no shared root cause
  or fix shape with another paused ticket.

## Result

104 paused -> 99 paused; 5 retired to `backlog/done/M8/`; 5 feature files
tombstoned; 5 absorber feature files rewritten; 4 epic trackers noted; 1
hotfix-ledger row re-linked.

## Why no deletion

The first cut of this sweep `rm`'d the five absorbed feature files. Within
five minutes the daemon's master-main reconcile (BL-891) logged
`merge-failed Error: merge deletes 'specs/features/BL-1521-...feature'
(BL-1519, introduced at a17bc78d43 ...), not named in the commit message`
and aborted: `check_merge_deletion.sh` reads `git diff --name-status -M
HEAD` (the WORKING TREE, so even an unstaged deletion counts) during a
merge and exempts a dropped path only when the MERGE message names its
ticket; the reconcile merges with `git merge --no-edit origin/main`, whose
message names nothing. So while main is diverged (it was: local ahead 11,
origin ahead 2 - the operator's cron fix and daemon topic records vs QA's
BL-1664/BL-1667 lands) a deletion on either side can never join, and even
a committed deletion would block the next reconcile until origin carried it
too (BL-1341 direction). The ten deleted paths were restored from HEAD
(09:44Z) and the five features rewritten as scenario-less tombstones -
modifications, never deletions - which lint clean and parse to zero
scenarios. Ticket YAML paths are exempt from that guard (BL-901's domain),
so the paused -> done/M8 moves stand. The same tick also refused the
reconcile on `swarmforge/runtime/handoff-draft.txt`, a TRACKED draft file
the coordinator's send had consumed (deleted in the working tree, not by
the specifier) - restored from HEAD the same way and surfaced to the
coordinator; a tracked runtime draft is a latent reconcile blocker every
time main diverges.

## Gates

(filled in below after the run)
