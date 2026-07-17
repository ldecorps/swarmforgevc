# Documentation Index

This project's docs follow the [Divio Documentation System](https://docs.divio.com/documentation-system/):
four modes, each serving a distinct reader need. Every authored doc below
lives under the mode that matches what a reader is trying to do with it.

Generated/asset directories that are not part of this classification —
`docs/archive/` (superseded material), `docs/briefings/` (daily briefing
artifacts), `docs/benchmarks/` (recorded benchmark data), `docs/i18n/`
(translation cache), `docs/roles-future/` (draft future-role prompts), and
`docs/diagrams/` (Mermaid sources, linked from Reference below) — stay where
the tooling that reads them expects them, and are not migrated or rewritten
here.

## Tutorials

*Learning-oriented: a guided first experience.*

- [Getting Started with SwarmForge VC](tutorials/GettingStarted.md) — install the extension, point it at a target, run a swarm, and get a PR.
- [Onboarding a New Project — and the Acceptance Contract](tutorials/Onboarding-New-Project.md) — bringing the swarm to a new/greenfield project and negotiating what it builds.

## How-to guides

*Task-oriented: recipes to accomplish a specific goal.*

- [Bringing Up a Second Swarm on Windows via WSL2](how-to/BL-091-wsl2-second-swarm-bringup.md)
- [Headless Secondary Swarms on a Raspberry Pi or VPS](how-to/BL-101-pi-vps-secondary-swarm-bringup.md)
- [Stripping an oversized blob from role-branch history](how-to/BL-105-history-strip.md)
- [Daemon Death Alarm — Understanding the Alert and Recovery](how-to/BL-144-daemon-death-alarm.md)
- [Verifying the stabilize-two-pack daemon-on workflow](how-to/BL-203-stabilize-two-pack-smoke-check.md)
- [Wiring the Phone Recert Inbound Address Live](how-to/BL-223-recert-inbound-address-golive.md)
- [Answering the Swarm Offline](how-to/BL-441-answering-offline-runbook.md)
- [Bringing Up the FES Second Swarm (mono-rotate, own Telegram identity)](how-to/BL-439-fes-second-swarm-bringup.md)

## Reference

*Information-oriented: exhaustive, neutral descriptions of how things are.*

- [SwarmForge VS Code Extension — Specification](reference/Specification.MD)
- [docs-tree.json schema](reference/docs-tree-schema.md)
- [backlog.json schema](reference/backlog-dashboard-schema.md)
- [Mutation-run worker RSS measurement report](reference/BL-427-mutation-worker-rss-measurement.md)
- [BL-007 Spec: Backlog Panel](reference/specs/BL-007-spec.md)
- [BL-008 Spec: Named runs](reference/specs/BL-008-spec.md)
- [BL-009 Spec: Hardened Message Bus](reference/specs/BL-009-spec.md)
- [BL-010 Spec: Heartbeat Decorator](reference/specs/BL-010-spec.md)
- [BL-011 Spec: Watchdog](reference/specs/BL-011-spec.md)
- [BL-012 Spec: Chase and Dead-Letter Escalation](reference/specs/BL-012-spec.md)
- [M2 Specification — Reliability Layer](reference/specs/m2-spec.md)
- Architecture and swarm-flow diagrams: [architecture.mmd](diagrams/architecture.mmd), [swarm-flow.mmd](diagrams/swarm-flow.mmd) (Mermaid sources)

## Explanation

*Understanding-oriented: discursive background and rationale.*

- [SwarmForge VS Code Extension — Milestone Roadmap](explanation/Milestone%20Roadmap.MD)
- [Headless swarm + extension reattach (operator doctrine)](explanation/headless-reattach-doctrine.md)
- [Handoff dual-path delivery (tmux primary, mailbox backup)](explanation/handoff-dual-path.md)
