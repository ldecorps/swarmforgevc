# QA bounce evidence: BL-513-pipeline-board-links-all-shown-alphabetical

1. **Failing command** (verification, not a build/test command):
   ```
   git merge-base --is-ancestor 7419a9dc cc23ec85bb   # exit 1 -> amendment MISSING
   grep -n "operatorAttributedUsd\|accumulateOperator\|operatorPart" \
     extension/src/metrics/telegramBridgeCost.ts
   ```

2. **Commit hash**: `cc23ec85bbbc6791521e598ac28420e22280dc0c` (documenter's BL-513 forward;
   QA's `merge_and_process` fast-forwarded straight to it, so it is QA's tested tip too).

3. **First error excerpt**:
   ```
   $ git merge-base --is-ancestor 7419a9dc cc23ec85bb; echo $?
   1
   $ grep -n "operatorAttributedUsd\|accumulateOperator\|operatorPart" extension/src/metrics/telegramBridgeCost.ts
   42:  operatorAttributedUsd: number;
   63:  operatorAttributedUsd: number;
   87:function accumulateOperator(acc: DayAccumulator, record: BridgeCostRecord): void {
   90:    acc.operatorAttributedUsd += operatorTelegramShare(record);
   98:  const acc: DayAccumulator = { frontDeskCount: 0, frontDeskUsd: 0, operatorCount: 0, operatorAttributedUsd: 0, unknownCount: 0 };
   104:      accumulateOperator(acc, record);
   108:  return { totalUsd: acc.frontDeskUsd + acc.operatorAttributedUsd, ...acc };
   122:  const operatorPart = `Operator $${summary.operatorAttributedUsd.toFixed(2)} attributed`;
   124:  return `Telegram bridge cost: $${summary.totalUsd.toFixed(2)} today (${frontDeskPart}, ${operatorPart}${unknownPart})`;
   ```
   This code path IS wired live: `swarmforge/scripts/handoffd.bb:948` (`telegram-bridge-cost-briefing-line`)
   shells the compiled `telegram-bridge-cost-line.js` CLI on every daily-briefing tick via
   `briefing_email_lib.bb:132-140`'s `:telegram-bridge-cost-line` adapter. `operator_runtime.bb` only
   ever appends `kind: 'front-desk'` records (confirmed by grep — no `kind :operator`/`operator-event`
   write path exists), so `operatorCount`/`operatorAttributedUsd` are always 0 and the rendered line
   will read `... (front-desk $X.XX (N calls), Operator $0.00 attributed)` on EVERY briefing, every day.

4. **Failure class**: `behavior`

5. **Expected vs observed**: Expected — the parcel's tree matches `main`'s current, already-approved
   BL-511 spec (front-desk-only; amendment `7419a9dc`, already on `main`, explicitly retires the
   Operator-capture/-proration scenarios and states "no separate Operator-capture ticket (declined)"
   because the always-on Operator has no per-wakeup `total_cost_usd` to measure, and inventing one
   would render a false "measured zero"). Observed — BL-513's parcel is built on top of the
   **pre-amendment** BL-511 implementation (coder `12de48dd`, cleaner cleanup `79790e51`), which still
   implements and live-renders the declined Operator dimension, and does NOT contain amendment
   `7419a9dc` at all. Landing this commit on `main` would (a) ship a daily-briefing line that always
   fabricates "Operator $0.00 attributed", directly contradicting the amendment's own stated rationale
   for why that must never be shown, and (b) fail to carry forward `main`'s already-committed spec
   amendment for BL-511, effectively regressing approved work the next time BL-511's real (amended,
   front-desk-only) rebuild — already in flight on `swarmforge-hardender` at `be863708` — tries to
   land and collides with this stale implementation of the same new file.

## Root cause
Not a defect in BL-513's own new work (pipeline-board LINKS). The coder/cleaner branch built and
cleaned up BL-511's original (pre-amendment) implementation, then — before that work was ever
forwarded as its own ticket — the specifier amended BL-511 in-flight and re-routed the amendment to
the coder for a fresh rebuild (`7419a9dc`, "Bounces to the coder to rebuild front-desk-only"). The
*old* BL-511 commits were never forwarded on their own (no `git_handoff` naming BL-511 exists in any
downstream role's mailbox — confirmed by grep) and were never reverted out of the coder/cleaner
branch either; that branch simply moved on to build BL-513 next, silently carrying the superseded,
live-wired BL-511 code the whole way to QA disguised as part of BL-513's parcel.

## Required fix
1. Revert `12de48dd` (coder) and `79790e51` (cleaner) — the pre-amendment BL-511 work — out of the
   coder branch (and consequently cleaner/architect/hardener/documenter once rebuilt), per the
   "A Bounce Must Be Reverted Out Of The Bouncing Branch" principle applied to abandoned/superseded
   in-flight work, not just literal QA bounces.
2. Rebuild BL-513 on a branch that does NOT carry the stale BL-511 implementation — either rebase
   BL-513's own commits (`9524fa63` coder, `daedee91` cleaner cleanup, `d39233cc` architect review)
   onto a point before `12de48dd`, or onto `main` (which already has the correct amendment `7419a9dc`
   and none of the stale code).
3. The real amended BL-511 rebuild is already in flight independently (`7419a9dc` -> `08d6f6c9` ->
   `ddd2e25c` -> `6bab99d4` -> `be863708`, currently on `swarmforge-hardender`) — do not re-do that
   work under BL-513; just make sure BL-513's own parcel no longer carries the old one.
