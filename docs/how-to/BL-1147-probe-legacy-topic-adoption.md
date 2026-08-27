# How to probe legacy topic adoption paths (BL-1147)

Operator intake asked to **probe legacy topic adoption** — three overlapping paths
that are easy to confuse. This slice ships a read-only filesystem probe plus
tests that lock the adoption branches; it does not close topics (BL-494) or
recreate BL topics (BL-495).

## The three paths

1. **BL-294 auto-open** — an unmapped front-desk topic (or DM default key) opens
   a fresh `SUP-###` via `openSubjectAndRecord` / `decideUpdateAction`
   (`telegramFrontDeskBotCore.ts`).
2. **Cursor Host topic re-adopt** — when `SWARMFORGE_LETS_TALK_PROVIDER` is not
   `cursor` (empty counts as cursor), a message on the bound cursor Host topic is
   adopted into `OPERATOR` instead of throwing bridge-owned
   (`openSubjectAndRecord` in `telegram-front-desk-bot.ts`).
3. **Map scrub** — `readFrontDeskTopicMap` strips stale `SUP` bindings on the
   cursor / Bubble topic ids via `frontDeskTopicMapWithoutCursorBridge` and
   persists when needed. Legacy per-ticket `BL-###` keys in
   `backlog-topic-map.json` are classified separately via `legacyTopicReconcile.ts`.

## Run the probe

From the repo root (or any checkout):

```bash
node extension/out/tools/probe-legacy-topic-adoption.js /path/to/target-repo
```

Exit code is `0` when the target directory is readable. The probe **never writes**
maps or calls Telegram.

### Sample output

```text
legacy topic adoption probe
legacy per-ticket topics:
  BL-101 -> topic 11
  BL-202 -> topic 22
cursor Host topic: 8435
bubble topic: (unbound)
SWARMFORGE_LETS_TALK_PROVIDER: local
cursor Host routing: operator-re-adopt
front-desk bindings on bridge topics: (none)
scrub candidates: (none)
```

When a stale `SUP` binding sits on the cursor Host topic id, `scrub candidates`
lists that topic key — the same keys `readFrontDeskTopicMap` would remove before
routing.

## Where it lives

- Pure probe: `extension/src/tools/probeLegacyTopicAdoption.ts`
- CLI: `extension/src/tools/probe-legacy-topic-adoption.ts`
- Cursor re-adopt branch: `extension/src/tools/telegram-front-desk-bot.ts` →
  `openSubjectAndRecord`
- Tests: `extension/test/bl1147ProbeLegacyTopicAdoption.test.js`,
  `extension/test/bl1147ProbeLegacyTopicAdoption.property.test.js`
- Acceptance: `specs/features/BL-1147-probe-legacy-topic-adoption.feature`

## Related tickets

- BL-294 — front-desk auto-open for DM / unmapped topics
- BL-494 — close legacy per-ticket topics (separate hand-run CLI)
- BL-727 — pilot acceptance gate (unrelated; different “probe” family)
