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

## 2. The acceptance contract

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

> **Not to be confused with:** this repo's README also uses the word
> "contract" for something unrelated — the small shell-function contract
> (`terminal_backend_label`, `terminal_backend_can_open_sessions`, etc.) a
> terminal backend adapter must implement (README, "Adding A Terminal
> Backend"). That's an internal plumbing contract for terminal automation; it
> has nothing to do with the acceptance contract described here.

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

## 3. Seeding a fresh project's initial contracts

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
