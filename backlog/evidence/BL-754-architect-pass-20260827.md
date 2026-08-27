# BL-754 — architect pass — 20260827

## Review inventory (Article 4.4)

NONE.

## Inbound

Cherry-picked cleaner `42da59b42e` (re-entry evidence only; merge conflict
avoided — full merge would have pulled unrelated backlog/conf drift). Coder
re-entry `fccf03f5b5` verified on cleaner line.

## Scope

`take-flow-reason` / `parse-flow-skip-reasons`: single-quote parity; unquoted
interior comma → `:malformed`; observational `skip_reasons_malformed=` on
handoff path. Declared invariants encoded in unit + acceptance (prior pass
20260824).

## Architecture

- Pure parse in `required_stages_lib.bb`; IO at `swarm_handoff` call sites.
- Matches approval: surface malformed remainder, never throw, never block send.
- Invariants 1–3 satisfied on `main` (see prior architect pass 20260824).

## Gates

| Gate | Result |
|---|---|
| Unit (`required_stages_test_runner.bb`) | on `main` — prior QA pass |
| Acceptance (BL-754 feature) | **5/5** on `main` (`40a58281c`) |
| Dep-gate | N/A (babashka/APS) |
| Diff vs `main` (BL-754 core) | **0** lines |

## Verdict

Already on `main`. Re-promotion evidence-only — **no functional change**
(Article 1.9). Complete inbound task; do **not** forward to hardender.

By architect.

