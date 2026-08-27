# BL-1190 — hardener pass — 20260827

## Inbound — commit substitution (3rd occurrence today, same class)

Received `git_handoff` from architect naming commit `0bf05774ac`. Sanity-checked
before merging given today's two prior incidents (BL-751, BL-1200): tree has
9820 files (sane vs HEAD's ~9770), merge-base is my own recent `499c9cb44`, and
a `--no-commit` dry-run merged clean with no conflicts (33 A / 29 M, no mass
deletion). This one is genuinely sound — matches the coordinator's own
`swarmforge-architect recovered` / `deletion diff empty` broadcasts. Merged as
commit `409435f8f`.

## What BL-1190 delivers

Closes the BL-1186 ghost-approval-ask gap: (1) pre-post gate refuses
`ApprovalRequested` unless `findTicketFilePath` succeeds
(`pendingApprovalFor.ts`, wired via `conciergeTick.ts`'s optional
`ticketFileExists` adapter); (2) `reconcileStaleApprovalAsks` closes a
recorded ask whose yaml disappeared; (3) `mintDurabilityGate.ts` refuses a
specifier "spec-ready" handoff unless the paused yaml is durably committed.

## Gates

| Gate | Result |
|---|---|
| Compile | PASS |
| Unit (9 touched-file suites) | 677/677 PASS (was 666 before this pass; +11 new tests) |
| Property (`bl1190GhostApprovalAskInvariants`, `approvalAskClosing`) | 4/4 PASS |
| Acceptance (`run_acceptance.sh`) | 4/4 PASS |
| CRAP (scoped to 7 touched files) | see below |
| DRY (`jscpd`, scoped to 7 touched files) | 2 clones found, both **pre-existing**, confirmed via baseline diff — see below |

## Mutation: automated Stryker blocked repo-wide by 4 independent, unticketed pre-existing defects

BL-149 cooldown gate: `mintDurabilityGate.ts` and `pendingApprovalFor.ts` are
brand-new (`file_age_days` reads as an enormous sentinel — no baseline on
`main` yet — correctly `DECISION: run` per the gate's own documented
epoch-0 convention); the other 5 touched files are `skip-cooldown`
(committed within the 3-day window).

Attempting a scoped `stryker run --mutate` for the two `run`-eligible files
hit Stryker's dry run (which must pass the WHOLE suite before any mutant
runs) failing on FOUR SEPARATE, confirmed-unrelated, confirmed-pre-existing
defects in sequence, none touched by BL-1190:
1. `startBridgeHeadlessCli.test.js` — spawns the real CLI, which fatal-errors
   for want of `CURSOR_API_KEY` (absent from this session's env entirely,
   not a leak). Worked around for my own invocation only
   (`CURSOR_API_KEY=fake-...`, not committed).
2. `cursorBridgeAgentSession.test.js` `isAbandonedAgentLock rejects invalid
   pid values` — asserts PID 42 is never a live process; on this host PID 42
   IS a real, live process (`systemd-journald`). Deterministic on this host,
   reproduces standalone outside Stryker too. Unticketed — sent a `note`.
3. `pilotAcceptanceGateCli.test.js` — `loadRawMkdtempGuard` resolves
   `test/helpers/rawMkdtempGuard` relative to the fixture's own mkdtemp'd
   target repo root instead of this tool's own installation root; reproduces
   standalone (outside any sandbox), not Stryker-specific. Unticketed.
4. `backfillEpicTopicIcons sets the finalised icon for each of the three
   seeded epics` — reproduces after (1)-(3) are worked around; not
   investigated further (stopped whack-a-moling after the 4th unrelated red
   in a row — this is a systemic full-suite-red condition, not scattered
   noise, and is the specifier's to triage, not mine to work around
   indefinitely).

Two of these (2, 3) were temporarily `.skip`'d, uncommitted, purely to probe
whether Stryker's dry run would clear afterward; both edits were reverted via
`git checkout --` before the 4th defect surfaced, confirmed via `git status`
clean. Nothing from this probing was committed.

**Fallback: hand-authored mutation sweep (BL-638 pattern)**, since the
automated tool cannot run at all on this host until (at minimum) defect #2
is fixed. Backed up each compiled file, applied each mutant to `out/`,
confirmed the killing test failure, restored via `cp` + `diff` verification:

`mintDurabilityGate.ts` (5/5 killed):
- M1 negate `isFileCommitted` check — killed (5/5 tests fail)
- M2 `{refused:false}` → `{refused:true}` — killed (2/5)
- M3 `{refused:true,...}` → `{refused:false,...}` — killed (3/5)
- M4 negate `if (!result.refused)` — killed (2/5)
- M5 remove `arm()` call — killed (1/5)

`pendingApprovalFor.ts` (3/3 killed, 1 new test added):
- M1 `!==` → `===` in `ticketFileExists` — killed (1/6)
- M2 drop `.trim()` on the captured id — **SURVIVED** on first run (no
  fixture used trailing whitespace/CRLF). Added
  `findTicketFilePath: matches an id: line with trailing whitespace after
  the value` (CRLF + trailing space case); re-verified M2 now killed (1/7)
- M3 `===` → `!==` in the backlogId comparison — killed (5/7)

## CRAP — BL-1190's own functions fixed; pre-existing debt correctly left alone

Differential check: for every function this scoped CRAP run flagged (>6), read
its content at the merge-base `c4e382c71` (before BL-1190's real content) to
determine whether BL-1190 introduced or modified it, per the standing
differential-complexity discipline.

| Function | Before | After | Note |
|---|---|---|---|
| `telegramFrontDeskBotCore.ts::reconcileStaleApprovalAsks` | 7.46 (new, 40% cov) | **4.00** | BL-1190's own deliverable #3 target, zero unit tests existed; added 5 new tests (empty/none-stale/single/multi-with-wait/no-waitBetweenCloses-default) |
| `telegramFrontDeskBotCore.ts::staleApprovalAsksNeedingClose` | 1.00 (new, partial cov) | **1.00**, 100% cov | Added 5 tests incl. a 2-candidate selector case (one stale, one live, one already-decided) per the standing "exercise a selector with 2+ candidates" discipline |
| `approvalAskClosing.ts::decisionLineFor` | 6.05 (89% cov) | **6.00** | The `'stale'` branch BL-1190 added was already tested; the pre-existing `'ruled'` branch (present at baseline, added by an earlier ticket) had ZERO tests — opportunistically closed since I already had this exact function open for the stale addition |
| `pendingApprovalReply.ts::readApprovalCloseVerdict` | 9.04 | 9.04 (unchanged) | **Untouched by BL-1190** (confirmed: 0 diff hits at this function) — pre-existing debt, out of scope |
| `pendingApprovalReply.ts::readHumanRulingFromText` | 7.54 | 7.54 (unchanged) | Same — untouched, pre-existing, out of scope |
| `conciergeTick.ts::buildTicketMetaLookup` | 9.00 (100% cov, CC=9 itself too high) | 9.00 (unchanged) | Same — untouched, pre-existing; more tests cannot lower this (already 100% covered), needs extraction, out of scope |

`mintDurabilityGate.ts` / `pendingApprovalFor.ts`: both new, CC=1-2, CRAP well
under 6, not flagged.

## DRY — 2 clones found, both confirmed pre-existing

Both isolated to single files (`pendingApprovalReply.ts` 7-line clone,
`telegramFrontDeskBotCore.ts` 59-line clone). Diffed each against its
`c4e382c71` baseline content run through the same `jscpd` config: both
clones reproduce byte-identically at baseline (only line numbers shifted, by
exactly the number of lines BL-1190 added/removed earlier in each file).
Pre-existing, not introduced or worsened by this ticket — out of scope.

## For the specifier — 4 unticketed pre-existing defects found this pass

Sent as `note`s (priority `00`) during this pass:
- `isAbandonedAgentLock rejects invalid pid values` assumes PID 42 is never
  alive; false on any host where it is (this host: `systemd-journald`).
  Deterministic, not flaky.
- (Not yet sent as a separate note — recorded here for the specifier's
  triage:) `pilotAcceptanceGateCli.test.js`'s `loadRawMkdtempGuard` resolves
  a tool-owned helper module relative to the FIXTURE's target repo root
  instead of this tool's own installation root — breaks any test whose
  fixture repo doesn't happen to contain `extension/test/helpers/
  rawMkdtempGuard.js`. Reproduces standalone, not sandbox-specific.
- `backfillEpicTopicIcons sets the finalised icon for each of the three
  seeded epics` — surfaced after the two defects above were worked around;
  not investigated (stopped after the 4th unrelated red to avoid an
  unbounded whack-a-mole chase). Together these 4 make the FULL unit suite
  (and therefore any repo-wide Stryker run) currently red on this host,
  independent of any one ticket.

## Forward

`git_handoff` to `documenter`, priority `00`, task `BL-1190-ghost-approval-ask-requires-live-yaml`.

By hardender.
