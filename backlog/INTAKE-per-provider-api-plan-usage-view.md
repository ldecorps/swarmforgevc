# INTAKE — Per-provider API plan usage query + consumption-rate view

**Source:** human via Cursor, 2026-08-29 ~12:54 BST  
**Status:** new intake, not minted. Specifier: assign a BL id and formalize
into `paused/`. Do **not** mint the id in this file (live specifier + other
pilots in flight → collision risk).

## Human ask (verbatim intent)

> Can each agent provider used by the swarm query the usage for the api it is
> using so we can have a view on how fast the plan is being consumed.

## Why this is in front of you

The swarm now runs (or can run) across several billed surfaces at once —
Cursor subscription, Anthropic / Claude plan, Qwen Token Plan (Anthropic-compat
endpoint used by `qwen-anthropic-forge` / `qwen-anthropic-mono-router`), and
any other provider pack in play. Today the human cannot see, in one place,
how fast each plan is being eaten.

What already exists (do not reinvent blindly):

- **Local transcript burn** — per-role tokens/hr from this host
  (`burnRate.ts`, `/burn-rate`, cost telemetry). Sees only local swarm
  transcripts, not account/plan remaining.
- **BL-619 token-burn briefing warning** — projects weekly Anthropic-style
  exhaustion from **manually transcribed** usage anchors
  (`usage-anchor.js record`). Spec-time finding then: *no programmatic
  Anthropic account-usage read was known*; that premise should be
  re-checked per provider, not assumed forever.
- **BL-552 / BL-553 (paused)** — Adaptive Quota & Budget Manager epic /
  Slice 1. Slice 1 is a read-only availability check over **existing**
  cooldown + cost-ledger state — it does **not** query provider billing/plan
  APIs. This intake is the missing “ask the provider how much plan is left /
  how fast it is going” half.

## Goal

Mint work so that **each agent provider the swarm actually uses** can report
plan/API usage (remaining and/or consumed, at whatever fidelity that
provider’s API exposes), and the swarm surfaces a **consumption-rate view**
(how fast the plan is being used) for the human — briefing and/or live
dashboard, specifier picks the first surface.

Acceptance direction (specifier to harden into scenarios):

1. For every configured/in-use agent provider, there is a defined usage query
   path (real API if available; honest “unsupported” if not — never fake a %).
2. A human-visible view shows per-provider usage and a rate (e.g. %/day or
   projected time-to-exhaustion), not only local token totals.
3. Unsupported providers are named as unsupported; the view never pretends a
   manual or local proxy is a live plan read.
4. Credentials stay on-host; no plan/usage secrets committed to git.
5. Revisit BL-619’s manual-anchor path: keep it as fallback where no API
   exists; prefer live query where one does.

## Locked human decisions

1. Want a **view of how fast each plan is being consumed**, driven by
   **provider-side usage queries** where possible — not only local transcript
   burn.
2. Scope is **each agent provider the swarm uses**, not Anthropic-only.

## Open for specifier / human

- First UI surface: morning briefing section vs holistic/burn dashboard vs
  both.
- Whether this becomes a new child under epic **BL-552** (`quota-budget-manager`)
  or a sibling feature that feeds BL-553 later.
- Per-provider feasibility matrix (Cursor / Anthropic / Qwen Token Plan /
  OpenRouter / …) — what each API can actually return today.

## Out of scope for this intake (unless human expands)

- Auto-throttling the swarm from plan % (Article 3.5 / depth cap) — view
  first; acting on it is a later decision.
- Replacing BL-551 cost ledger or BL-209 rate-limit cooldown detection.
- Billing/invoice scraping or browser automation of provider consoles.

## Pointers

- Epic: `backlog/paused/BL-552-epic-adaptive-quota-budget-manager.yaml`
- Slice 1 (existing cooldown/ledger only): `backlog/paused/BL-553-quota-manager-availability-check.yaml`
- Manual anchors / briefing warning (done): `backlog/done/BL-619-briefing-burn-rate-exhaustion-warning.yaml`
- How-to: `docs/how-to/BL-619-token-burn-briefing-warning.md`
- Local burn: `extension/src/metrics/burnRate.ts`, `burnProjection.ts`
- Current multi-provider packs: `swarmforge/packs/qwen-anthropic-forge.conf`,
  `swarmforge/packs/qwen-anthropic-mono-router.conf`
