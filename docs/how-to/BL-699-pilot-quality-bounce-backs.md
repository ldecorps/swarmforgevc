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
   **Every poll must include an extra option labeled exactly `Need more detail`**
   so the human can say they lack context to answer. If that option wins, the
   pilot posts a richer brief (or fewer sharper polls) and asks again — silence
   is not consent. Poll send helpers may still grow; the prompt rule is in force.

## What stays unchanged

- `/pilot` stays distinct from automated `/expedite` (`expedite_cli` / `claude -p`).
- The gate that refuses `/pilot` while an expedite lock is held is unchanged.

## Siblings

- BL-700 — Telegram status posts on ticket / hat / bounce
- BL-701 — orphan acceptance / Stryker cleanup at stage boundaries

## Where it lives

- Prompt: `extension/src/tools/telegramCursorBridgePilot.ts` →
  `composePilotExpeditorPrompt`
- Tests: `extension/test/telegramCursorBridgePilot.test.js`
- Acceptance: `specs/features/BL-699-pilot-quality-bounce-backs.feature`
