# Onboarding a New Project — and the Acceptance Contract

This guide is for plugging SwarmForge into a **new or greenfield** target
project. For installing and running the SwarmForge VC extension itself, see
[Getting Started](GettingStarted.md) first — this guide picks up from "point
it at a target" and focuses on what actually drives the swarm's work: **the
acceptance contract**.

## 1. Onboarding mechanics (reuse, don't re-derive)

The mechanical steps — install the extension, set the target, launch, watch,
get a PR — are already covered in [Getting Started](GettingStarted.md); this
guide does not repeat them. Two things specific to a brand-new target are
worth calling out:

- **Initialize Target** (`swarmforge.initializeTarget`) scaffolds and commits
  `project.prompt` and `engineering.prompt` into the target repo, so they
  travel with it when the swarm clones/works it. These carry the target
  project's own goals and engineering conventions — see `project.prompt` and
  `local-engineering.prompt` in this repo for the shape they take here.
- If the target directory is not already a git repository, SwarmForge
  initializes one and makes the first commit at startup (README, startup
  step 5) — a brand-new project does not need to be a git repo beforehand.
- **Initialize Target**'s scaffold is generic placeholder text
  (`<what this project does and why>`-style angle brackets). Section 2 below
  (BL-269) generates SURVEY-POPULATED content for these same two files as
  part of the onboarding contract negotiation — whichever runs first for a
  given target wins that file (existence-only idempotency), so running the
  onboarding survey/negotiation before or instead of a bare `Initialize
  Target` gets you real content immediately rather than blanks to fill in.

## 2. The onboarding scope contract (survey → propose → agree)

Before any build work dispatches for a target at all, the swarm and the
operator settle a separate, higher-level **onboarding contract** — the
overall mandate for what the swarm will (and will not) do on this repo. This
is new as of BL-262 and sits *above* the per-ticket acceptance contract
described in section 3 below: agreeing the onboarding contract doesn't
replace or skip per-ticket `human_approval` — every feature draft still gets
its own sign-off — it just gates whether *any* ticket can start at all.

- **Survey.** An onboarding agent reads the target repo's own code and
  structure (languages, layout, README) plus any seed vision and initial
  backlog, and gathers that into a `RepoSurveyFacts` fixture (the survey
  itself is swarm/agent behavior; everything downstream of it is a pure
  function fed that fixture).
- **Propose.** `proposeContractFromSurvey`
  (`extension/src/onboarding/contractSurvey.ts`) maps those facts into a
  `ProposedContract` — scope, out-of-scope, boundaries, and an initial-backlog
  summary all populated from the survey (never a blank template) — marked
  `agreement: proposed`. `node extension/out/tools/propose-onboarding-contract.js
  <target-repo-path> <survey-facts-json-path>` runs this and scaffolds +
  commits the result into the target repo via `initializeTargetContract`
  (`extension/src/config/targetBootstrap.ts`, reusing the same idempotent
  plan/write/commit seam `initializeTargetRepo` already uses for
  `project.prompt`/`engineering.prompt`).
- **Hybrid artifact.** The contract is git-tracked in the *target* repo, not
  machine-local state: `.swarmforge/contract.yaml` is the structured source
  the gate parses, and a generated `CONTRACT.md` is a legible view for the
  target's humans, rendered from that same source
  (`generateContractMarkdown`/`renderContractYaml` in
  `extension/src/onboarding/contractView.ts`) so the two can never diverge.
- **Agree.** The operator reviews `CONTRACT.md` (or the yaml directly) and
  flips `.swarmforge/contract.yaml`'s `agreement` field from `proposed` to
  `agreed` once satisfied. To re-open scope later, flip it back to `pending`
  and re-negotiate — the gate re-holds automatically.
- **Gate.** Before promoting a paused ticket into `backlog/active/`, the
  coordinator runs `node extension/out/tools/onboarding-contract-gate.js
  <target-repo-path>` (`swarmforge/roles/coordinator.prompt`'s Onboarding
  Contract Gate section). The gate is **fail-closed**
  (`evaluateBuildStartGate`, `extension/src/onboarding/buildStartGate.ts`):
  only an `agreed` contract allows dispatch. A missing, malformed, `proposed`,
  or `pending` contract all hold, each with a reason naming why — a target
  with no contract yet simply reads as `missing` (hold), so it must be
  surveyed and proposed before any ticket for it can start.

This ships as slice 1 (survey → propose → a single agree/hold decision). An
iterative negotiate loop (request changes → revise → re-propose, repeating
until agreed) is designed but not yet built — parked in
`specs/features/BL-262-onboarding-contract-agreement.slice-2-negotiation.feature.draft`.

**The same negotiation also generates `project.prompt`/`engineering.prompt`
(BL-269, a child slice of this family).** `proposePromptsFromSurvey`
(`extension/src/onboarding/promptProposal.ts`) maps the identical
`RepoSurveyFacts` used above into survey-populated `project.prompt` and
`engineering.prompt` content — real prose, not section 1's generic
placeholder template. These two files ride the *same* agreement marker as
the contract (one agreement, whole artifact set): `node
extension/out/tools/propose-onboarding-prompts.js <target-repo-path>
<survey-facts-json-path>` is safe to re-run at any point — while the
contract is `proposed`/`pending` it's a no-op (`withheld: true`, nothing
written), and only once the contract is `agreed` does the same command
actually write and commit both files into the target repo. Re-running it
after the operator flips `agreement` to `agreed` is what releases them.

## 3. The acceptance contract

This is the part the operator asked about specifically.

### What it is

The **acceptance contract** is SwarmForge's mechanism for saying WHAT the
swarm should build, in a form that is both human-reviewable and
machine-executable:

- The specifier expresses each work item's acceptance criteria as **Gherkin
  scenarios** (Given/When/Then), saved into a `.feature` file under
  `specs/features/`. Per `swarmforge/roles/specifier.prompt`, these scenarios
  **are** the contract the coder implements against.
- Since BL-111, feature files are the **durable** contract — they outlive the
  backlog ticket that created them (`specs/features/*.feature` "are the
  acceptance contract and outlive the backlog item," per the shared
  engineering article). A ticket can be closed and archived; its feature file
  stays in the tree as the living record of what that behavior contractually
  does.
- Each backlog ticket's YAML carries an `acceptance:` field that is a path
  reference to its feature file (`acceptance:
  specs/features/<ticket-id>-<slug>.feature`), not inline Gherkin. This is
  the link between "what was asked for" (the ticket) and "what must remain
  true" (the feature file).
- **QA gates on it.** The final pipeline stage runs the acceptance suite and
  requires every scenario in the ticket's referenced feature file to pass
  (N/N) before the work is approved. The contract isn't aspirational — it's
  the actual pass/fail bar the swarm is held to.

> **Not to be confused with:** two other things in this project also use the
> word "contract." Section 2 above describes the **onboarding scope
> contract** — a project-level, survey-and-agree mandate gating whether any
> ticket can start at all; this section's acceptance contract is a *separate*,
> per-ticket thing that still applies underneath it. This repo's README also
> uses "contract" for something unrelated again — the small shell-function
> contract (`terminal_backend_label`, `terminal_backend_can_open_sessions`,
> etc.) a terminal backend adapter must implement (README, "Adding A Terminal
> Backend"), an internal plumbing contract for terminal automation with
> nothing to do with either of the above.

### How a new project gets its first contract

1. **Intake.** A request lands as a raw item in `backlog/` (the intake root)
   or is described directly to the specifier.
2. **Specifier writes the spec.** The specifier turns the request into a
   prose `description:` (what/why/constraints) plus Gherkin `acceptance:`
   scenarios, following the format in `swarmforge/roles/specifier.prompt`
   (one scenario per distinct observable behavior; shared `Given` setup moved
   into a `Background:`).
3. **Feature file + lint.** The scenarios are saved to a new
   `specs/features/<ticket-id>-<slug>.feature`, and the specifier runs
   `swarmforge/scripts/gherkin_lint_gate.sh <feature-file>` before ever
   handing the ticket off — a parcel never proceeds behind a feature file the
   gate rejects.
4. **Human approval gate.** A freshly drafted or changed feature file is not
   treated as final until a human has reviewed it. Tickets carry this
   explicitly, e.g. a trailing `# HUMAN APPROVAL: ...` comment and/or a
   `human_approval: pending`/`approved` field in the ticket YAML — the swarm
   does not silently treat its own draft as authoritative.
5. **Build-then-promote discipline for sliced work.** When a deliverable
   ships in slices, the *live* feature file must contain only scenarios for
   slices that are actually **built** — the acceptance runner throws on any
   scenario lacking a step handler, hard-failing the gate. Scenarios for
   not-yet-built slices are parked in a non-executable companion file (a
   `<slug>.feature.draft`, which no `*.feature` glob or the runner picks up),
   preserving the up-front design without breaking the gate. Each slice's
   scenarios move from the draft into the live feature file only once that
   slice is implemented.
6. **Ticket promotion.** The specifier writes new tickets into
   `backlog/paused/` — writing a spec does not start work. The coordinator
   promotes a paused ticket into `backlog/active/` (respecting the
   configured depth cap) when a slot is open, and that's when the pipeline
   actually begins building against the contract.

### A concrete minimal example

`backlog/done/BL-249-pwa-sw-cache-name-content-derived.yaml` and its feature
file `specs/features/BL-249-pwa-sw-cache-name-content-derived.feature` show
the linkage end to end:

- The ticket YAML's `acceptance:` field points directly at the feature file:
  `acceptance: specs/features/BL-249-pwa-sw-cache-name-content-derived.feature`.
- The feature file opens with a comment block naming the bug/behavior, a
  `Background:` shared by all scenarios, and one `Scenario:` per distinct
  observable behavior (e.g. "a deploy that changes the shell delivers the
  update to a returning user"), each preceded by a stable comment name
  (`# BL-249 shell-change-reaches-users-01`) per the specifier's naming
  convention.
- The ticket's trailing `# HUMAN APPROVAL: ...` comment records that this was
  a new specifier-drafted feature file pending human review before being
  treated as authoritative.

For a slice-scoped example (draft-then-promote in practice), compare a
ticket's live `.feature` file against its sibling `.feature.draft` — e.g.
`specs/features/BL-235-per-tile-backend-model-switch.cross-backend.feature.draft`
alongside `BL-235-per-tile-backend-model-switch.feature` — to see scenarios
for a not-yet-built slice parked outside the executable glob.

## 4. Seeding a fresh project's initial contracts

For a genuinely new target with no backlog yet, the human's inputs enter the
same way any request does: drop a raw description into the target's
`backlog/` root (or describe it directly). The specifier drains the backlog
root first (before touching anything already in `paused/`/`active/`), turns
each raw item into a proper spec with its own feature file as described
above, and writes the result to `backlog/paused/`. From there, normal
coordinator promotion takes over. There is no separate "first contract"
ceremony — the first ticket for a new project goes through exactly this same
intake → spec → feature-file → human-approval → promotion flow as every
ticket after it.

---

For the full pipeline stage-by-stage breakdown, the handoff protocol, and the
product roadmap beyond onboarding, see [Specification.MD](Specification.MD).
