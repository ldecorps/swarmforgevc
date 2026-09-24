# BL-1682 — coder rebuild pass, 2026-09-24

## What landed

Per the specifier's send-back ruling
(`backlog/evidence/BL-1682-bounce-20260924.md`): replaced
`docs/reference/local-model-briefing.md` with the byte-exact contents of
`backlog/evidence/BL-1682-operator-briefing-20260924.md` (the operator's
2026-09-24 trim for the CPU-bound IQ3 27B seat), via `cp` rather than a
hand-typed rewrite - no risk of a stray trailing-newline or encoding
difference the sha256 check would silently miss.

- Size: 1049 bytes (matches the amended ticket's own stated size).
- `sha256sum docs/reference/local-model-briefing.md`:
  `8ff4ad6a7e615b71344547fd80a4f958c4edac3e7e97cb0fc93d07d0437fe55c`
  (matches the amended ticket's qa_e2e_procedure step 3 exactly, and the
  bounce evidence's stated hash).

Nothing else in the parcel changes: the code (`localQwenSeatLive.ts`), its
unit tests, the acceptance feature and step handler, and the property test
are all unaffected - the feature's own scenario 01 uses a fixture string
("Project briefing text.") rather than the real file's content, per the
amended ticket's own note ("the feature file does not pin the text and is
unchanged").

## Verification

| check | result |
|---|---|
| `sha256sum docs/reference/local-model-briefing.md` | `8ff4ad6a7e615b71344547fd80a4f958c4edac3e7e97cb0fc93d07d0437fe55c` - exact match |
| `wc -c docs/reference/local-model-briefing.md` | 1049 - exact match |
| `npx vitest run test/bl1235LocalQwenSeatLive.test.js` | 20/20, unaffected |
| `npx vitest run test/docsStructureRealTree.test.js` | 5/5 - the file is still linked from `docs/index.md`, no new orphan |
| `specs/pipeline/scripts/run_acceptance.sh` on this ticket's feature | 3/3 |
| `npx vitest run --config vitest.properties.config.mjs test/bl1682LocalSeatBriefingSystemPrompt.property.test.js` | 2/2, unaffected (drives `completeWithLocalModel`/`readLocalSeatSystemPrompt` directly over fixture files, never the real repo doc) |
| `npm test` (compile + unit lane) | 636 files / 10861 tests, all green, exit 0 |

## Not acted on here (per the bounce's own routing)

- The documenter's own fact-check pass ("hardener" vs the repo's
  `hardender` role id) - the bounce evidence explicitly assigns this to
  the documenter, not the coder, and the wording is the operator's own to
  change, not mine to silently correct.
- The master checkout precondition (the operator's untracked copy must be
  cleared before landing) - operator-side, not a parcel concern.

By coder.
