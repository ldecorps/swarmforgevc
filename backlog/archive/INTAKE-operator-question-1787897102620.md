
---

## Specifier: PARKED awaiting human answer (2026-08-28 ~06:17Z)

Raised via `role_ask.bb` into the specifier Telegram topic (`"asked": true`).
**Do not re-ask** — one pending question per role. Resume by acting on the
answer; the research below is already done, do not repeat it.

### Asked

1. **Shape.** The front-desk topic currently bridges to **Cursor**
   (`extension/src/tools/telegramCursorBridgeFrontDeskRedeploy.ts`, bridge
   `:8765`). Replace it / add alongside as a selectable backend / triage only
   and escalate?
2. **Tag.** Could not verify, and said so rather than guessing.

### Findings (already established — reuse, don't re-derive)

- **ollama is not installed on this host.** `which ollama` → not found;
  `http://localhost:11434/api/tags` → no response.
- **Registry tag lookup is not possible from here.**
  `registry.ollama.ai/v2/library/{qwen3-coder,qwen2.5-coder,qwen3}/tags/list`
  all return `404 page not found`.
- **No confirmable `qwen3-coder` ~14B build.** Qwen3-Coder's smallest published
  build is 30B-A3B; `qwen2.5-coder:14b` is the realistic reading of the ask.
- **Prior art is real and all targets pipeline SEATS, not the front desk** —
  do not re-mint it:
  - `BL-1082` the swarm can pull and serve a named model on this host
  - `BL-1140` steward local model bake-off
  - `BL-1143` cold-swap day-shift to ollama-qwen3-mono-router
  - `BL-1127` local coder evidence bar · `BL-1126` local-agent Telegram turns
  - Packs already exist: `swarmforge/packs/local-model-mono-router.conf`
    (`qwen2.5-coder:7b-instruct`), `qwen-mono-router.conf`.
- **Architecture constraint (local-engineering rule 7):** the front desk is the
  *host agent* interface; Cursor is its current incarnation. A second
  incarnation is in policy — a rename to erase "Cursor" is not.

### On resume

Mint against the answer, set `epic:` (likely the local-model epic BL-1143 sits
in), and spec ollama provisioning as in-scope unless the human says it already
runs elsewhere.

---

## DISPOSITIONED 2026-08-28 — minted as BL-1235

Human answered the parked question directly, correcting the premise rather
than picking one of the three offered options:

> To be clear, cursor stays behind the usual host topic and front desk.
>
> I want local qwen only behind its dedicated one:
> https://t.me/c/4415865297/41004

So it is **not** the front desk: a dedicated topic (chat `4415865297`, topic
`41004`), with cursor keeping both of its current surfaces untouched.

Minted `backlog/paused/BL-1235-local-qwen-seat-behind-its-own-topic.yaml`
(acceptance `specs/features/BL-1235-local-qwen-seat-behind-its-own-topic.feature`).
One intake, one ticket. The model tag remains unverifiable from this host and
is specced as configuration rather than guessed into a constant.
