# is_qa_ancestor.sh cannot verify a land built under the interim condition (f) recipe

BL-1654 landed cleanly as `08ae1cd0ef` (pushed to `origin/main`, full
verification/ruling paper trail: `BL-1654-QA-20260920.md` and several
specifier rulings). `is_qa_ancestor.sh 08ae1cd0ef` reads "not approved":
its `source_is_approved` checks only DIRECT ancestry of the recorded
source commit against `swarmforge-QA` (no recursive JSONL chain lookup).
The interim condition (f) recipe (`backlog/evidence/BL-1537-...-20260912.md`,
"Condition (f), amended... until BL-1662 lands") explicitly instructs
building the land on a throwaway scratch branch and "delete the scratch
branch. Never merge it back" — so the scratch tip (`4499a7d380`) can never
become a direct ancestor of `swarmforge-QA`, and this audit check will
read every land built this way as unapproved until BL-1662 lands and the
interim recipe retires.

Recorded here as an observation, not an escalation: the land itself is
legitimate and fully documented; this is a known, narrow, temporary side
effect of the interim workaround, scoped to whatever the (f)-recipe lands
between now and BL-1662.

By QA.
