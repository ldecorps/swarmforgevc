# INTAKE — Model Steward generates swarm pack configs from a named profile

**Source:** human via Cursor, 2026-09-01 ~08:36 BST  
**Status:** new intake, not minted  
**Priority:** medium — expands Model Steward from consult/certify into pack
composition; pairs with the cheaper-swap / economic path (BL-545 remaining
slices, BL-1056 price windows) without replacing them.

## Goal

When asked (operator / coordinator / human), **Model Steward generates a
swarm pack `.conf` (or a concrete cast overlay) according to a named
profile** — e.g. “mono-router, Anthropic-quality baseline, cheaper coder”,
“full-forge depth 3, maximize Token Plan”, “Bob multi-provider diversity”.

It **picks only from models already known to the steward** (registry +
role matrix + certification status), and **handshakes every pick** before
the conf is offered as runnable — so a generated pack never names a model
that is unavailable, uncertified for that seat, or dead on this host’s
keys/endpoints.

## Why this is not “just edit a pack by hand”

Today pack confs are hand-authored folklore. Steward already owns:

- what is registered / certified / role-ranked
- compliance batteries and scorecards
- BL-669-style substitute consult for outages

It does **not** yet own “compose a whole cast from a profile and prove the
cast boots.” Without that, cheaper-swap and failover proposals stay
seat-local patches; operators still assemble packs by copy-paste.

## Profile (input) — direction, not schema

A profile should be able to name at least:

- **Topology:** mono-router vs standing forge (and depth / rotation)
- **Cost posture:** prefer `cost_class` / price tier down where quality
  evidence allows (ties to economic review; do not invent a second price
  table — BL-1056 / cost table are the source of truth)
- **Quality floor:** per-role steward score / certification minimum; refuse
  to staff below floor
- **Provider constraints:** allow/deny lists (e.g. keep Anthropic for
  coordinator, Qwen Token Plan OK for coder only)
- **Home seat rules:** mono-router home must remain poke-reliable (Claude
  agent family unless profile explicitly accepts another)

Exact profile file format is for the specifier — YAML/JSON under
`.swarmforge/model-steward/profiles/` is fine if that fits existing store
layout.

## Handshake (mandatory before “ready to launch”)

For each `(role → provider/model[/agent])` the steward proposes:

1. **Registry:** model is registered; status allows assignment for that role
   (`assignment-eligible?` / role-matrix — same bar as BL-669 / BL-1318 intent)
2. **Credentials / endpoint:** the host can actually reach it (key present,
   endpoint responds — reuse existing provider guards / token-plan / Anthropic
   paths; do not write secrets into the generated conf)
3. **Optional live probe:** minimal completion or steward battery ping when
   cheap enough; skip only when profile says `handshake: registry-only` and
   document that weaker bar

A failed handshake **drops or replaces** that pick and re-resolves; a pack
that cannot satisfy the profile’s floors **fails loud** with which seats
could not be staffed — never emit a conf that lies about availability.

## Output

- A generated pack conf (or ModelFactory overlay) under a steward-owned path
  plus a short evidence note (profile id, picks, handshake results)
- **Propose, do not silently install** as the live day-shift pack unless an
  explicit apply step / human approval says so (same “never autonomous seat
  mutation” discipline as the economic-review intake)

## Relations

- BL-545 / Model Steward (BL-547, BL-557) — owner
- BL-525 ModelFactory — may consume the cast as an assignment overlay
- BL-1056 — honest prices for cost-aware profiles
- BL-669 — outage substitute consult is the seat-local sibling; this intake
  is whole-pack composition
- Live example of mixed cast intent: `bob-multi-provider-mono-router.conf`
  (Anthropic seats + Qwen Token Plan coder) — a profile should be able to
  regenerate that shape from policy, not from memory

## Specifier notes

- Do not promote epic BL-545 itself.
- Prefer one mintable child (or a thin epic + one vertical slice: “profile →
  conf + handshake CLI”) over boiling the ocean.
- Firm: handshake before “runnable”; no secret material in generated files.
