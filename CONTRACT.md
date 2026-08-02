# SwarmForge Onboarding Contract

Agreement: proposed

## Scope
- Deliver the seed vision: Milestone 1 MVP: a developer can select a target repo, launch a swarm, watch every agent in live interactive tiles inside VS Code, occasionally nudge an agent, and end up with a pull request to review, without leaving the editor. This repo is dogfooding itself: the swarm building SwarmForge VC is the same swarm the extension will let others run. Later milestones (already underway) extend this into a full remote-control surface: Telegram/Bubble messaging, pipeline board, model routing, swarm intelligence layer, backlog governance.
- Work within the existing TypeScript, Babashka/Clojure, Kotlin, Shell, Gherkin codebase (layout: extension/ (VS Code extension host + webview UI, TypeScript), swarmforge/ (maintained fork of SwarmForge's tmux/babashka pipeline machinery, scripts + role prompts + constitution articles), android/ (Bubble native companion app, Kotlin), pwa/ (static git-SHA-reproducible backlog dashboard), specs/ (Gherkin features + acceptance pipeline step handlers), backlog/ (root intake, paused/active/done/hold ticket queues), docs/ (how-to, explanation, reference, diagrams).).

## Out of scope
- Rewriting or replacing the existing TypeScript, Babashka/Clojure, Kotlin, Shell, Gherkin stack.
- Changes outside the surveyed layout (extension/ (VS Code extension host + webview UI, TypeScript), swarmforge/ (maintained fork of SwarmForge's tmux/babashka pipeline machinery, scripts + role prompts + constitution articles), android/ (Bubble native companion app, Kotlin), pwa/ (static git-SHA-reproducible backlog dashboard), specs/ (Gherkin features + acceptance pipeline step handlers), backlog/ (root intake, paused/active/done/hold ticket queues), docs/ (how-to, explanation, reference, diagrams).) unless the initial backlog explicitly calls for them.

## Boundaries
- Constraints stated in the target's README: SwarmForge VC is a VS Code extension that is a visual front-end for SwarmForge, Uncle Bob's tmux-based multi-agent coordination tool. It launches a SwarmForge swarm against a target repo, shows every agent working in live terminal tiles inside VS Code, tracks pipeline stage, and opens a pull request at the end. It drives and observes an unmodified, separately-installed SwarmForge rather than reimplementing it. The swarm itself runs a disciplined specifier->coder->cleaner->architect->hardener->documenter->QA pipeline with quality gates (coverage, mutation testing, CRAP, DRY) at each stage.
- Every feature still passes through its own per-ticket human_approval gate; this contract sets the overall mandate, not per-ticket sign-off.

## Initial backlog
Backlog is organized into epics (swarmforge console, pipeline board, code-quality gates, model routing, fleet topology, swarm intelligence layer, adaptive quota/budget manager, root capability commands, spec-drift realignment) with many child tickets already completed into backlog/done/M1-M8, a handful of active/paused tickets in flight, and root-level human intake items awaiting specifier drafting. Work is defect-heavy at the moment (post-hoc master-diff reviews surfacing gaps between working-tree half-changes and what gates actually measure).

---
This contract firms the overall mandate for the swarm working on this repo.
It sits above the per-ticket approval gate on each individual feature draft —
it does not replace it. To change scope, flip `agreement` back to `pending`
in `.swarmforge/contract.yaml` and re-negotiate.
