# BL-440 QA bounce — 2026-07-16

1. **Failing command** — a Node repro script driving the real compiled
   `drainAnswerFiles` (same module/functions the acceptance steps use)
   against a fresh git fixture:

   ```js
   const { drainAnswerFiles } = require('extension/out/tools/drain-answer-files');
   const { readRecord, appendMessage } = require('extension/out/concierge/blTopicStore');

   // BL-100 is ACTIVE, status: todo - never shipped, never closed.
   // fixture: backlog/active/BL-100-fixture.yaml with status: todo

   // The swarm asked a question, then explicitly RETRACTED it - the
   // ticket itself stays active/todo throughout (BL-325's own incident
   // shape: a ticket can remain open while a SPECIFIC question on it is
   // superseded).
   appendMessage(repoRoot, 'BL-100', { author: 'swarm', type: 'outbound', text: 'Q1: should we use approach A or B?' });
   appendMessage(repoRoot, 'BL-100', { author: 'swarm', type: 'outbound', text: 'RETRACTED Q1 - we decided to go with approach C instead, no need to answer.' });

   // The human, offline, never saw the retraction and answers the STALE Q1.
   // backlog/ANSWER-2026-07-16.md: "Re BL-100: go with approach A."

   const results = drainAnswerFiles(repoRoot);
   ```

2. **Commit hash checked out and tested**: `8be18685` (QA worktree HEAD,
   documenter merge of `570bde4d69`).

3. **First error excerpt** — no thrown error; the drain silently acts on
   the stale, already-retracted question:

   ```json
   [
     {
       "file": "ANSWER-2026-07-16.md",
       "reference": "BL-100",
       "disposition": "acted-on"
     }
   ]
   ```

   and the topic record afterward shows the stale answer appended as a
   normal accepted inbound message, sitting right after the swarm's own
   retraction:

   ```json
   {
     "messages": [
       { "type": "outbound", "text": "Q1: should we use approach A or B?" },
       { "type": "outbound", "text": "RETRACTED Q1 - we decided to go with approach C instead, no need to answer." },
       { "type": "inbound",  "text": "Re BL-100: go with approach A." }
     ]
   }
   ```

4. **Failure class**: `behavior`. Nothing crashes or fails to compile; the
   gate simply does not gate the exact case it exists to gate.

5. **Expected vs observed**: Expected — per the ticket's own acceptance
   criteria (`BL-440 offline-answer-file-return-path-02`, Scenario Outline
   with three DISTINCT `<drift>` examples: "already shipped", "its question
   retracted", "its decision superseded") and the feature file's own
   motivating comment ("memory: escalation-resends-retracted-question"), an
   answer to a question that has since been retracted must be reported
   `arrived-late` and never appended as an accepted answer. Observed —
   `checkPremiseLive` (`extension/src/tools/drain-answer-files.ts:110-122`)
   checks ONLY the referenced ticket's folder (`done`?) and its own
   `status` field; it never reads the topic's own message history
   (`blTopicStore.ts`'s `readRecord`, which the same file already imports
   for the opposite direction via `appendMessage`) to check whether a later
   swarm message has already superseded the specific question the answer
   responds to. Since BL-100 stays in `backlog/active/` with `status: todo`
   throughout this repro, `checkPremiseLive` reports `live: true` and the
   stale answer is blindly executed — reproducing the exact "escalation
   re-sends a retracted question ... the human answered the stale text"
   incident the ticket's own feature-file comment names as its motivation.

   The Scenario Outline's own step-handler fixtures
   (`specs/pipeline/steps/bl440OfflineAnswerFileReturnPathSteps.js`,
   `DRIFT_FIXTURES`) mask this: `"its question retracted"` is wired to
   *no ticket file written anywhere* (an unresolvable-ticket fixture, not a
   still-active-ticket-with-a-superseded-question fixture) and `"its
   decision superseded"` is wired to a ticket whose folder is `active` but
   whose own YAML `status:` field is already `done` — a second variant of
   the SAME "ticket status says done" branch already covered by "already
   shipped". All three example rows exercise only two real code branches
   (`folder === 'done'` and `status === 'done'`; the "not found anywhere"
   branch is really testing scenario 05's unresolved-reference shape, not
   retraction). None of the three actually drives the still-open,
   still-active ticket whose specific question moved on — the literal case
   named twice in this ticket's own text and tested nowhere. The acceptance
   report's "3/3 killed" reads as full coverage of shipped/retracted/
   superseded; it is coverage of one signal wearing three labels.

   Remediation direction (not prescriptive): `checkPremiseLive` (or its
   caller) needs to also consult the referenced ticket's OWN topic record
   (`readRecord`, already imported in this file) and detect whether a
   swarm `outbound` message postdating the one the answer is presumably
   responding to has superseded/retracted it — or some other concrete
   check against real per-question state — rather than relying solely on
   ticket-level `status`/folder, which cannot distinguish "still awaiting
   this exact question" from "moved on without shipping."
