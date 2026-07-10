# INTAKE: onboarding contract — the target repo AGREES to a contract firming up what the swarm will do

Source: operator direction 2026-07-10 (via coordinator): "I want to plug the
swarm into a new project… the target repo has to AGREE to a contract with the
swarm firming up what the swarm is going to do." Operator chose SPEC + BUILD it.

## Why this is new (coordinator verified — do not document it as existing)
No such mechanism exists today. Onboarding is purely mechanical
(`swarmforge/constitution/articles/project.prompt:46`, `docs/archive/
bootstrap-brief.md`): point the extension at a target repo path, copy the
constitution files in, run the swarm. The only agreement that exists is the
PER-TICKET `human_approval` gate (operator approves each feature draft one at a
time). There is NO project-level, up-front step where the target repo agrees to
a contract firming up the swarm's overall scope before build starts. Grep for
agreement/charter/mandate/SOW/scope-agreement found nothing implementing it.

## Want (the capability to design + build)
An explicit ONBOARDING CONTRACT step, gating build on the newly-onboarded target:
  1. PROPOSE — after the swarm is pointed at a target repo, the swarm drafts a
     scope/charter: what it is going to do (and, ideally, what it will NOT do) —
     derived from the target's seed vision / initial backlog.
  2. AGREE — the target repo (operator) reviews and AGREES to that contract;
     the agreement is RECORDED as a durable, git-tracked artifact in the TARGET
     repo (reproducible — see [[pwa-vs-holistic-surface-boundary]] / the
     git-reproducible rule; NOT machine-local state).
  3. GATE — until the contract is agreed, the swarm does NOT start dispatching
     build work. Once agreed, build proceeds. A change of scope re-opens the
     contract (re-agreement), rather than silently drifting.

This is a PROJECT-LEVEL scope agreement that sits ABOVE the existing per-ticket
`human_approval` gate — the specifier should make that relationship explicit
(the onboarding contract firms up the overall mandate; per-ticket approval still
gates each feature). Do not replace or duplicate `human_approval`.

## Design questions for the specifier to resolve (verify the live tree first)
- CONTENT: what the contract states — scope / deliverables the swarm commits to,
  explicit out-of-scope, boundaries/constraints, a summary of the initial
  backlog. Keep it small and legible.
- ARTIFACT + CONSENT: how the target "agrees" — a committed agreement file in the
  target repo (e.g. `.swarmforge/contract.*` or a `CONTRACT.md`) carrying an
  explicit agreed/pending marker the operator flips, reusing the `human_approval`
  field PATTERN (structured + legible). Git-tracked in the target so it is
  reproducible and auditable.
- GATE MECHANICS: where build-start is gated. The gate decision ("contract present
  AND agreed → build may start; else hold") must be a PURE, testable function on
  injected state — never a live-swarm dependency in unit tests. Identify the real
  place build dispatch begins (coordinator promotion / first-parcel dispatch) and
  wire the gate there without a hot-edit to live role protocol (BL-247 lesson:
  sequence any role-prompt change through the pipeline WITH the mechanism).
- ONBOARDING FIT: compose with the existing "point at target + copy constitution"
  flow (`project.prompt`) and the delivered onboarding guide
  `docs/Onboarding-New-Project.md` (acceptance-contract-centered) — this ADDS the
  up-front agreement layer; cross-link, don't fork.

## Constraints
- The contract + agreement live in the TARGET repo, git-tracked (reproducible),
  not machine-local.
- TESTABLE host-side: gate decision + contract parse/agree-state are pure
  functions fed fixtures; no live swarm / real timer / real repo in unit tests.
- REUSE the `human_approval` structured-field pattern for the agree marker; do
  not reinvent consent plumbing.
- BL-247: no hot-edit of live role protocol — any coordinator/role prompt change
  that enforces the gate lands WITH the mechanism, sequenced through the pipeline.
- Likely SLICED: (a) the contract artifact + agree marker; (b) the build-start
  gate; (c) the swarm's scope-proposal draft; (d) documenter extends
  Onboarding-New-Project.md with the shipped mechanism. Specifier scopes slices.

## Delivery
Design-heavy; buildable after specifier scopes it. Park in backlog/paused/ for
operator approval (feature draft needs `human_approval`). When shipped, the
documenter documents it (extend the onboarding guide). Priority: operator to set;
suggest normal — it is foundational to onboarding but not blocking current work.
