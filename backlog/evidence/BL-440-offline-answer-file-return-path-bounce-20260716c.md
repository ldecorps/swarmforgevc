# BL-440 QA bounce (3rd) — 2026-07-16

## Verdict: BOUNCE — not a defect in BL-440's own work, but its commit cannot be
## merged to `main` without also shipping BL-438's separately-bounced defect

## BL-440's own work: verified correct

This submission (documenter `0c66e788c7`) DOES fix the defect from the prior
two bounces (`BL-440-offline-answer-file-return-path-bounce-20260716.md`,
`...-20260716b.md`). Confirmed:

- `checkPremiseLive` (`extension/src/tools/drain-answer-files.ts`) now calls
  the new `hasRetractedPendingQuestion(readRecord(repoRoot, ticketId))` and
  treats a retracted/superseded pending question as premise-not-live.
- `hasRetractedPendingQuestion` (`extension/src/concierge/blTopicStore.ts`)
  checks the topic's own latest message for `retractsPendingQuestion === true`
  — reading the topic's own message history, exactly what the prior bounces
  said was missing.
- The flag has a real production writer, wired end to end: a successful gate
  answer (`operatorDecideStatus.ts`'s `applyGateDecision`) → `operator-decide.ts`'s
  `appendToReplyOutbox` → `operatorEventQueue.ts`'s reply-outbox reader →
  `telegramFrontDeskBotCore.ts`'s `deliverReply`/`sendReply` →
  `telegram-front-desk-bot.ts`'s real adapter → `blTopicStore.ts`'s
  `appendMessage` — never a second, parallel, untested store.
- The Scenario Outline step fixtures (`bl440OfflineAnswerFileReturnPathSteps.js`)
  were rewritten per the 2nd bounce's own finding: `"its question retracted"`
  and `"its decision superseded"` now each write a still-active ticket whose
  topic record carries a real `retractsPendingQuestion: true` message, and
  assert a `retracted or superseded`-specific reason string — no longer
  reusing the "already shipped" ticket-status branch.
- Full unit suite green: 290 files / 4337 tests passed
  (`extension && node_modules/.bin/vitest run`).
- Acceptance pipeline green: `run_acceptance.sh
  specs/features/BL-440-offline-answer-file-return-path.feature` — 7/7,
  including all three Scenario Outline rows.

## Why this is still a bounce: the commit is not mergeable to `main` as-is

`0c66e788c7`'s only parent is `089bd710d7` — the documenter's BL-438 commit I
bounced minutes earlier in this same session
(`BL-438-needs-human-on-disk-signal-bounce-20260716.md`). That bounce found
`089bd710d7` ships `needsHumanFromEscalations` (deriving `needs_human` from
`.swarmforge/daemon/chase-escalations.json`, the per-pack-role stuck-mailbox
signal, which `compositeNode.ts`'s own header comment says structurally
EXCLUDES the coordinator) instead of the architect-approved
`needsHumanFromAwaitingAnswer` (the coordinator's real ask+await state) — a
real regression against the ticket's own acceptance scenario 1, confirmed by
repro: a coordinator genuinely blocked on a human, with no pack-role
chase-escalated, reports `needs_human: false`.

Since `0c66e788c7` is built directly on top of `089bd710d7` (diff between them
is 2 lines of `docs/Specification.MD` only — every code file BL-440 needs was
already present at `089bd710d7`), landing `0c66e788c7` on `main` would land
`089bd710d7`'s bounced `needsHumanFromEscalations` implementation right along
with it, under BL-440's approval. Today's `main` still hardcodes
`needs_human: false` (BL-437's own honest placeholder) — merging this commit
would silently replace that honest placeholder with a WRONG-but-plausible-
looking implementation that never fires for the coordinator's real blocked-
on-human state, which is strictly worse than the current placeholder and is
exactly the regression the BL-438 bounce exists to prevent.

## Evidence (BL-140 contract)

1. **Failing command** — same repro as the BL-438 bounce, re-run against
   THIS commit to confirm the entanglement (not a new independent defect):

   ```sh
   git worktree add --detach /tmp/bl440-repro 0c66e788c7
   cd /tmp/bl440-repro/extension && npm run compile
   mkdir -p /tmp/bl440-fixture/.swarmforge/operator /tmp/bl440-fixture/swarmforge
   echo 'config swarm_name fes' >> /tmp/bl440-fixture/swarmforge/swarmforge.conf
   printf 'coder\ttask\n' > /tmp/bl440-fixture/.swarmforge/roles.tsv
   cat > /tmp/bl440-fixture/.swarmforge/operator/awaiting-answer.json <<'EOF'
   {"question":"q","thread_id":"SUP-1","asked_at_ms":0}
   EOF
   node -e "
   const { buildFleetStatusDoc } = require('/tmp/bl440-repro/extension/out/tools/emit-fleet-status.js');
   console.log(JSON.stringify({ needs_human: buildFleetStatusDoc('/tmp/bl440-fixture', 0).needs_human }));
   "
   ```

2. **Commit hash checked out and tested**: `0c66e788c7` (documenter's handoff
   to QA, task `BL-440-offline-answer-file-return-path`).

3. **First error excerpt**:

   ```json
   { "needs_human": false }
   ```

   — identical to the BL-438 bounce's repro, because `0c66e788c7` carries
   `089bd710d7`'s code unchanged for this file.

4. **Failure class**: `behavior` (would-be regression against `main`, not a
   defect in BL-440's own acceptance criteria).

5. **Expected vs observed**: Expected — a commit QA merges to `main` must
   never carry forward a separately-bounced ticket's defective code, even as
   an unrelated passenger file. Observed — `0c66e788c7`'s sole parent is the
   just-bounced `089bd710d7`, so merging it would ship BL-438's rejected
   `needsHumanFromEscalations` under BL-440's approval.

## Remediation direction (not prescriptive)

BL-440's own diff (`checkPremiseLive`/`hasRetractedPendingQuestion`/writer
wiring/step fixtures) is ready. Once BL-438 is fixed and forwarded, the
fix will land on this same worktree lineage; re-forward BL-440 from that
later commit (or, per constitution Article 2.6, forward one commit that
satisfies both BL-438 and BL-440 together, naming both ticket IDs) so QA can
merge a `main`-safe commit that carries neither ticket's rejected state.

By QA.
