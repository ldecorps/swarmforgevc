# Documenter task: onboarding write-up for plugging the swarm into a NEW project — centered on THE CONTRACT

Source: operator direction 2026-07-10 (via coordinator): "I want to plug the
swarm into a new project. Is there an onboarding procedure — the one with the
contract... in particular, the contract. Get the documenter to do a write-up."

## Deliverable
A clear onboarding guide for pointing SwarmForge at a NEW/greenfield project.
Suggested path: `docs/Onboarding-New-Project.md` (link it from README's
Getting Started list; do NOT silently duplicate `docs/GettingStarted.md` — reuse
and cross-link it). THE CONTRACT is the centerpiece; the operator asked for it
"in particular."

## What "the contract" means here (verified sources — read them, don't guess)
The operator's "the contract" is the **acceptance contract**, SwarmForge's
defining mechanism for saying WHAT the swarm should build:
- `swarmforge/roles/specifier.prompt:20` — the Gherkin scenarios "ARE the
  `acceptance:` contract the coder implements against."
- `swarmforge/roles/specifier.prompt:36-42` (BL-111) — "Feature files under
  `specs/features/` are the durable acceptance contract" (reverses the older
  "specifier writes the contract only" rule).
- `swarmforge/constitution/articles/engineering.prompt:91` — feature files "are
  the acceptance contract and outlive the backlog item."
- Backlog ticket YAML's `acceptance:` field points at the feature file; QA
  gates on it (N/N scenarios pass). Explain the ticket→feature linkage.
NOTE — do NOT confuse this with the unrelated "small contract" at README §307,
which is only the terminal-backend adapter shim (`terminal_backend_*` functions).
Call that out briefly so a reader isn't misled, then move on.

## Cover, at minimum
1. Onboarding mechanics (reuse GettingStarted.md, don't re-derive): install;
   point the swarm at a target dir; `README:187` — startup git-inits an empty
   target and makes the first commit; run/watch; get the PR.
2. THE CONTRACT (the substance the operator wants):
   - What the acceptance contract IS (feature files = durable contract, BL-111)
     and WHY it is the source of truth (coder builds to it, QA gates on it, it
     outlives the ticket).
   - How a NEW project GETS its first contract: the intake → specifier →
     `specs/features/*.feature` flow; the `# HUMAN APPROVAL` / `human_approval`
     field gate on a new feature draft; the backlog ticket `acceptance:` link.
     Show the build-then-promote discipline (a live `.feature` must be built,
     never a live-but-unbuilt feature = 0/N gate fail) — see how the specifier
     drafts `.feature.draft` and the coder promotes it live on build.
   - A concrete minimal example: one backlog ticket YAML + its one `.feature`
     acceptance file, showing the linkage end to end.
3. Where the operator's inputs go for a fresh project: how to seed the initial
   vision/backlog so the specifier can author the first contracts.

## Constraints
- GROUND IT in the real files above; verify every path/line before citing (this
  brief's line numbers may drift — confirm against the live tree).
- REUSE existing docs (GettingStarted.md, README, the constitution articles);
  cross-link rather than duplicate.
- Accuracy over completeness: if any onboarding step is unclear or missing in the
  current tree, say so explicitly rather than inventing it.
- When done, remove this brief file.
