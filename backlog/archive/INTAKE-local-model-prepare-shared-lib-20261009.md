# INTAKE — Shared local-model prepare lib (recruiter invokes, steward judges)

**Source:** human via Cursor, 2026-10-09 ~19:30 BST, verbatim (Article 5.3):

> Rebuild and pass to specifier

**Context:** A prior agent session claimed to implement
`local_model_prepare_lib.bb` + wiring; those paths were missing from the
checkout. Human asked where the libs were, then ordered a rebuild and a pass
to the specifier.

**Epic / track:** `local-llm-swarm` (BL-1125). Touches BL-547 (steward),
BL-1700 (coder probe), recruiter weekly (BL-1127 battery path), and the paused
onboarding how-to BL-1956 (cross-link only — do not expand that doc ticket here).

**Priority:** mint next for local-coder bakeoff honesty. Bare HF tags keep
producing empty-implement 0/5 probes that mis-rank challengers.

## What is wanted

Specifier: drain this intake and mint (or refuse with reason) INVEST ticket(s)
for a **shared local-model prepare** path:

1. Frozen Modelfile template → `ollama create` alias + think-off aider profile.
2. Recruiter may **invoke** prepare after pull, before battery; still offer-only
   (never pack launch, conf edit, seat bind, or commit).
3. Steward may prepare / re-probe; still owns certify and judgment.
4. BL-1700 probe accepts prepare profile (`--model-settings-file` / `--prepare`)
   and one automatic retry on the empty-response fail shape.
5. No automatic live-pack cold-swap.

A **draft implementation already exists in the same tip as this intake**
(paths listed in
[docs/design/briefs/2026-10-09-local-model-prepare-shared-lib.md](../docs/design/briefs/2026-10-09-local-model-prepare-shared-lib.md)).
Adjudicate: land/amp that draft under the minted ticket, or re-scope and have
coder rebuild. Unit runners were green at file time
(`local_model_prepare_lib_test_runner.bb`,
`model_steward_coder_probe_lib_test_runner.bb`).

## Out of scope for the first mint

Pack conf generation, shim/qwen seat-stack as sole bar, host VRAM/KV apply,
cold-swap / day_shift automation.

## Brief

Full ownership table and file list:
[docs/design/briefs/2026-10-09-local-model-prepare-shared-lib.md](../docs/design/briefs/2026-10-09-local-model-prepare-shared-lib.md)
