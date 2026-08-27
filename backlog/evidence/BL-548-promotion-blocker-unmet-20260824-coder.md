# BL-548 promoted with its own promotion_blockers still unmet

**Stage:** coder · **Date:** 2026-08-24 · **Ticket:** BL-548 (`backlog/active/`)
**HEAD checked:** `2547e85ff` (merged `main` into `swarmforge-coder` after QA merge-up)

## Finding

BL-548's `promotion_blockers` require BL-546 Slice 2 (adapters +
`SWARMFORGE_PROMPT_EXPERIMENT` isolation) AND BL-547 Slice 2
(`model-steward evaluate`) on `main` before this ticket may be worked —
"not merely those tickets done at Slice 1."

Re-checked on current `main` tip (same as `origin/main`, left-right `0 0`):

1. **`model-steward evaluate` is absent.**
   `swarmforge/scripts/model_steward_cli.bb` still dispatches only
   `status/show/register/certify/decertify/role-matrix/capability/adapter/eligible`.
   No `evaluate` subcommand. Sibling ticket **BL-556** (`backlog/paused/`)
   owns that Slice 2 drain and remains paused (its own GH-22-era
   `promotion_blockers` text).

2. **`SWARMFORGE_PROMPT_EXPERIMENT` is absent.**
   Repo-wide search under `swarmforge/` and `extension/` finds zero
   matches outside BL-548's own ticket/feature prose and the prior
   2026-07-23 blocker evidence. Experiment-mode isolation for compose
   does not exist on `main`.

3. **Partial adapter work is not enough.**
   BL-574 (`backlog/done/M8/`) landed PromptEngine Slice 2 fragments +
   adapters, but that parcel did not introduce the experiment env
   contract BL-548's feature scenarios require
   (`SWARMFORGE_PROMPT_EXPERIMENT` unset → production incumbent only).

4. **Parent tickets closed at Slice 1 only.**
   Live features remain Slice-1 scoped; BL-546 Slice 2–3 scenarios stay
   in `specs/features/BL-546-prompt-engine-slices-2-3.feature.draft`
   (trimmed after BL-574); BL-547 Slice 2 lives as BL-556, not on `main`.

## Why this matters

BL-548 Slice 1 acceptance requires composing experimental adapter
variants and invoking `model-steward evaluate` once per variant.
Implementing those under BL-548 would be BL-556 / experiment-isolation
work mis-scoped — the same refusal recorded 2026-07-23
(`backlog/evidence/BL-548-promotion-blocker-unmet-20260723-coder.md`).

## Requested action

1. Move BL-548 `active/` → `paused/` (clear `assigned_to: coder`).
2. Do not re-route BL-548 until BL-556 (`evaluate`) is on `main` and
   experiment-mode isolation (`SWARMFORGE_PROMPT_EXPERIMENT`) exists.
3. When a slot opens, prefer promoting **BL-556** (or a minted
   experiment-isolation ticket) ahead of BL-548.

No behavior implementation under this ticket this turn.
