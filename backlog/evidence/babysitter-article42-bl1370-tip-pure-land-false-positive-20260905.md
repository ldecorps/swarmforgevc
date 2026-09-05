# Article 4.2 escalation adjudication — BL-1370 tip-pure land

**Finding:** babysitter health sweep flagged `4409993daf6c52d630a67f394faa2ca2246e8183`
("BL-1370: tip-pure land -- own paths only, replayed onto origin/main",
touching `extension/test/bl1370WorktreeStrayCheck.property.test.js`,
`specs/pipeline/steps/bl1370WorktreeStrayCheckSteps.js`) as pipeline code
landed on `main` outside QA (Article 4.2/BL-247).

**Investigation (2026-09-05):**
- `.swarmforge/land-approvals/2026-09.jsonl:28` already carries a correct
  land-approval record: `{"ticket":"BL-1370","commit":"4409993daf","source":"c981dc13e9"}`.
- First run of `is_qa_ancestor.sh 4409993daf` returned rc=1 ("source
  c981dc13e9 ... not itself approved") — a transient race: `c981dc13e9`
  (QA's own merge of documenter `d6e44499b7` into the QA worktree) had not
  yet landed on `swarmforge-QA` at that instant.
- Re-run moments later: rc=**0**, "approved: 4409993daf is a land-step
  replay of approved source c981dc13e9 ... BL-1334". `git merge-base
  --is-ancestor c981dc13e9 swarmforge-QA` now confirms true.
- No bounce record for this sha or ticket.

**Verdict:** false positive — the standard tip-pure-land ancestry race
(source in the `.worktrees/QA` land-approval record needed its own
merge-back into `swarmforge-QA` to complete; it has now completed). Same
class as prior 09-04 reproductions
([[article42-predicate-is-ancestry-only-qa-handland-always-flags]]).

**Action taken:** none — self-cleared on re-check. No revert, no
escalation to the human. Recorded here per the "first check on any Art 4.2
wake" convention so a re-fire on this sha is recognized as already owned.
