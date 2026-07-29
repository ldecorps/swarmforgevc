# How to read /pilot quality and bounce-back rules (BL-699)

When you start a Cursor-staffed offline expedition with `/pilot` on the Cursor
Remote topic, the bridge feeds the agent `composePilotExpeditorPrompt`. That
prompt is the contract for how the agent wears every pipeline hat.

## What the prompt requires

1. **Quality over speed** — prefer correctness, evidence, and gate discipline
   over finishing quickly.
2. **Bounce-backs are first-class** — if a later hat finds an upstream defect,
   return to that role, fix it with a clear rationale, and re-walk downstream.
   Do not paper over issues just because the run already passed that stage.
   Do not rush a QA stamp.
3. **Human questions use a Telegram poll** on Cursor Remote — clear question
   plus discrete options; wait for the vote. Free-text-only asks are not enough.
   Poll send helpers may land in a later slice; the prompt rule is already in force.

## What stays unchanged

- `/pilot` stays distinct from automated `/expedite` (`expedite_cli` / `claude -p`).
- The gate that refuses `/pilot` while an expedite lock is held is unchanged.
- Sibling work (Telegram status-post matrix, orphan cleanup) is out of scope here.

## Where it lives

- Prompt: `extension/src/tools/telegramCursorBridgePilot.ts` →
  `composePilotExpeditorPrompt`
- Tests: `extension/test/telegramCursorBridgePilot.test.js`
- Acceptance: `specs/features/BL-699-pilot-quality-bounce-backs.feature`
