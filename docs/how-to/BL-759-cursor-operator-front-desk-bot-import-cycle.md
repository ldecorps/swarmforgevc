# Breaking the front-desk ↔ Cursor-operator import cycle (BL-759)

The front-desk bot lazily loads the Cursor-operator modules
(`telegramCursorOperatorExec.ts`, `telegramCursorOperatorLiveness.ts`), and
those modules used to import drain helpers straight back out of
`telegram-front-desk-bot.ts`. That is a real import cycle. The extension's
dependency-rule gate reported three forbidden `acyclic` edges on every
whole-repository scan that touched any of the three files — even though the
bot's own edges were lazy `await import(...)`, so there was no circular
module-init hazard at runtime.

## What moved

| Symbol | Now lives in | Notes |
| --- | --- | --- |
| `isPipelineEmpty`, `resolveLiveRoles` | `extension/src/tools/telegramPipelineDrain.ts` | Shared leaf; no bot import |
| `controlDrainTimeoutMs` | `extension/src/tools/telegramControlCore.ts` | Same timeout resolution as before |
| Re-exports | `telegram-front-desk-bot.ts` | Callers that imported from the bot keep working |

`telegramCursorOperatorExec.ts` and `telegramCursorOperatorLiveness.ts`
import the leaf modules only. `notify-dead-letters.ts` follows the same
direction. Drain / emptiness / timeout behaviour is unchanged — this tip is
structural.

## Operator check

From `extension/` after compile:

```bash
node out/tools/dependency-gate.js
```

Expect **PASSED** with no forbidden edges. Acceptance:
`specs/features/BL-759-cursor-operator-front-desk-cycle.feature`.

## Related

- Host operator commands: `docs/how-to/BL-698-telegram-cursor-operator-commands.md`
- Shared-token front desk / bridge fan-out: `docs/how-to/BL-764-front-desk-shared-token-bridge-fanout.md`
