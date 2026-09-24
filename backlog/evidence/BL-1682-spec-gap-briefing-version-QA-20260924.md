# BL-1682 - QA spec-gap note: which briefing text lands (2026-09-24)

Parcel commit: f70e54d39d ("Merge documenter 423a6a6dee into QA.")

Every code gate passes on this commit, one run each: unit, property, acceptance (the BL-1682
feature), pre_qa_gate, sibling-check VERIFY, register join empty, and qa_e2e step 1
(`vitest run test/bl1235LocalQwenSeatLive.test.js` 20/20). There is no implementation defect.

## The gap (spec-gap; nothing is bounced, nothing is reverted)

The ticket says `docs/reference/local-model-briefing.md` "lands with the parcel as the operator
wrote it", starting from the operator's 2026-09-21 patch. The parcel does exactly that:
coder 05c0905a02 applied the 09-21 draft (2210 bytes), and documenter 7b08fb7e9a fact-checked
it (2212 bytes). Its first line is `# Local model briefing (QWEN_LOCAL host seat)`.

Since then the operator has replaced the live file. The shared master checkout's untracked
docs/reference/local-model-briefing.md is now 1049 bytes (mtime 2026-09-24 07:44). Its first
line is "You are a local assistant for the SwarmForge VC project, running on the operator's own
machine. ...", and it is a compressed rewrite of the same content: shorter sections, and "Answer
in a few short sentences that read well aloud." This matches the operator's 09-24 trim for the
CPU-resident IQ3 27B seat, where prompt eval is slow at depth, so a 2212-byte system prompt costs
roughly twice the 1049-byte one on every turn.

Consequences if the parcel lands as built:
1. qa_e2e step 3 ("prints the operator's heading") passes only against the superseded draft,
   not the operator's current text.
2. The master checkout still holds the operator's file untracked. The ticket's own precondition
   is that the operator clears the master copy before this lands. The two tracked files are
   already restored, but the untracked briefing is still there. So a merge of main into master
   refuses, and resolving that refusal overwrites the operator's trimmed briefing with the older
   text.

## What the specifier needs to decide

Which text is "the operator's": the 09-21 draft (as built) or the live 09-24 trim. If it's the
trim, the parcel's briefing file must be replaced with the operator's current bytes (the
documenter re-checks facts, per the ticket), and the master precondition still applies either
way. QA has not landed the parcel and holds its approval until the ruling. Once the spec is
amended and the parcel rebuilt, QA re-runs only the changed-file checks.

By QA.
