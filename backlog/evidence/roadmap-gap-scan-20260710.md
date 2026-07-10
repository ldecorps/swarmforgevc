# Roadmap gap scan — 2026-07-10

Coordinator-initiated audit (operator request: "fill new tickets in paused" ->
pull from the roadmap): cross-referenced `docs/Milestone Roadmap.MD` and
`docs/Specification.MD` against every existing backlog ticket (active/paused/
done, ~230 tickets) to find roadmap capabilities with no corresponding ticket
anywhere. Full method: general-purpose research agent grepped ticket titles/
descriptions and the `extension/src/` tree per candidate before concluding a
gap is real (not just absent from a title).

## Ranked gap candidates (best first)

1. **Per-tile backend/model switch-on-the-fly UI control** — M5 roadmap bullet;
   Spec.MD lines 186, 575-661 (a `model ▾` dropdown per tile that respawns that
   agent on a new backend). BL-130/BL-142/BL-206-208 build the provider
   abstraction and static per-role config; none add a live per-tile switch
   control. Size: medium — depends on the (already-done) abstraction layer.

2. **Effort dial (reasoning-effort/thinking-budget suggestion, per role)** — M5
   bullet; Spec.MD line 688. Zero tickets mention "effort dial"/"reasoning
   effort"/"thinking budget". BL-233 (active) ranks *models* by cost/fit but
   never touches a per-role effort parameter. Size: small-medium, depends on #1.

3. **Two-way chat adapter (Telegram/Signal/WhatsApp/Teams)** — M6 bullet;
   Spec.MD lines 1386-1408. Nothing exists: BL-065 is read-only REST+SSE,
   BL-097/BL-117/BL-150/BL-220/BL-223 are all the PWA (web, not a bot), BL-073/
   BL-217 are email only. Size: large — new networked infra + bot API.

4. **"Answer `to: human` gates remotely" (general mobile gate-answering)** — M6
   headline bullet; Spec.MD lines 1356-1367. The only phone-side write path
   (BL-150) is scoped narrowly to Gherkin recert, not general blocking-question
   answering. BL-094 explicitly says phase 2 is read-only, "control endpoints
   remain a later phase." Size: large.

5. **Remote security hardening (token rotation, read-only-vs-control scope,
   device revocation)** — M6 bullet; Spec.MD line 1426. BL-065's bridge has one
   static bearer token, no rotation/revocation/scoping. Size: medium; logically
   sequenced after #4 (no control surface to harden yet).

Also confirmed but not listed above as a gap since it's more clear-cut:
**accessibility** (keyboard nav of tiles/tree, screen-reader labels) is a
self-admitted open item in Spec.MD line 1438 ("need a pass"), with zero
tickets addressing it — BL-220 only adds a font-size control, not the rest of
the tile/tree UI's keyboard/ARIA coverage. Size: medium, systematic pass across
webview + PWA.

## Already covered — do not re-propose
- Cost-aware selection / recruiter -> BL-233 (active).
- Load measurement -> BL-071, BL-078, BL-100, BL-102, BL-213.
- Backend abstraction internals -> BL-130, BL-142, BL-206, BL-207, BL-208.
- Reroute machinery -> BL-063 (done); dependency-aware eligibility -> BL-018
  (done, checks `depends_on` against `backlog/done/`).
- Read-only remote projection + phone notify -> BL-065, BL-094, BL-097, BL-073,
  BL-099, BL-213.

## Stale/contradicted roadmap claims (treat with skepticism, not as new work)
- **Windows-native is NOT first-class today**, despite the roadmap and Spec.MD
  claiming it drove the "own the orchestrator instead of tmux" design decision.
  `swarmforge/constitution/articles/local-engineering.prompt` says "Target OS:
  macOS and Linux only... Do not write Windows-specific code," and BL-091
  (done) explicitly rules native Windows out of scope ("tmux is the process
  substrate by architecture rule and has no native Windows port") — the
  opposite of the spec's own stated rationale. This is a real doc-vs-reality
  contradiction worth surfacing to the operator, not a ticket to silently spec.

Full agent transcript available on request (session-local, not persisted).

## Specifier follow-up — operator decisions + spec status (2026-07-10)

Specced this pass (paused/):
- Gap #1 per-tile backend/model switch -> **BL-235** (M5).
- Gap #2 effort dial (Suggest tier + manual dial) -> **BL-236** (M5, depends_on BL-235).
- Windows contradiction -> **BL-237** docs-fix (operator ruled: fix docs to macOS/Linux only).

Operator decisions for the remaining gaps (spec next; decisions recorded here so
they are not lost):
- Gap #3 two-way chat adapter — platform = **Telegram** first (free bot API);
  other platforms follow the same adapter shape. M6, large.
- Gap #4 remote gate-answering — posture = **answer captured needs-human gates
  only** (submit an answer to a specific captured gate; NO arbitrary keystrokes /
  shell). Narrow, auditable write scope. M6, large.
- Gap #5 remote security hardening — sequence AFTER gap #4 (no control surface to
  harden until #4 lands). M6, medium.
- Accessibility (keyboard nav + ARIA across webview + PWA) — decision-free;
  spec next. Medium.

Windows ruling: docs are wrong, not the architecture — BL-237 corrects the docs;
do NOT spec native Windows support.
