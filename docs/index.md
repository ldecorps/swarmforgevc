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
- [Stuck-Role Escalation Email — Understanding the Alert](how-to/BL-349-stuck-role-escalation-email.md)
- [Driving one ticket through every gate with the swarm stopped (the expeditor)](how-to/BL-567-expedite-one-ticket-with-the-swarm-stopped.md)
- [Ambulance mode — running one ticket exclusively while the swarm stays live](how-to/BL-655-ambulance-mode-the-hold.md)
- [Verifying the stabilize-two-pack daemon-on workflow](how-to/BL-203-stabilize-two-pack-smoke-check.md)
- [Wiring the Phone Recert Inbound Address Live](how-to/BL-223-recert-inbound-address-golive.md)
- [Checking Pipeline Board Ticket Links](how-to/BL-513-pipeline-board-current-folder-links.md)
- [Using the Operator Telegram Console](how-to/BL-516-operator-telegram-console.md)
- [Answering the Swarm Offline](how-to/BL-441-answering-offline-runbook.md)
- [Bringing Up the FES Second Swarm (mono-rotate, own Telegram identity)](how-to/BL-439-fes-second-swarm-bringup.md)
- [Model Steward: Onboarding, Certification, and Role Recommendations](how-to/BL-547-model-steward-overview.md)
- [ModelFactory: Assigning and Applying Agent Models](how-to/BL-525-model-factory-assign-and-apply.md)
- [Handling Pre-QA Gate Handoff Refusals](how-to/BL-531-handoff-refusal-remedies.md)
- [Understanding and Handling Sibling Bounce Deferrals](how-to/BL-532-sibling-bounce-deferral-runbook.md)
- [Context Telemetry: Recording and Querying Agent Invocations](how-to/GH-22-context-telemetry-recorder-and-query-cli.md)
- [Monitoring Agent Context Budget in the Mini App Console](how-to/GH-23-context-budget-dashboard.md)
- [Reviewing Paused Tickets in the Mini App Console](how-to/BL-538-console-paused-ticket-pager.md)
- [Let's Talk — Discrete Audio Turns in the Mini App Console](how-to/BL-696-miniapp-lets-talk-cursor-audio.md)
- [Reordering Epic Priority in the Mini App Console](how-to/BL-572-console-epic-priority-reorder.md)
- [Relaunch Resume and the Orphan-Claim Sweep](how-to/BL-648-relaunch-resume-orphan-claims.md)
- [Launching the Perplexity mono-router pack](how-to/perplexity-mono-router-launch.md)
- [Aged-note Actionability in Mono-router: Draining Dormant Mailboxes](how-to/BL-576-aged-note-actionability-mono-router.md)
- [GitHub Auto-Intake Scheduler](how-to/github-auto-intake-scheduler.md)
- [/pilot's acceptance-contract landing gate](how-to/BL-727-pilot-acceptance-contract-gate.md)
- [Sharing one Telegram bot between the front desk and the Cursor bridge](how-to/BL-764-front-desk-shared-token-bridge-fanout.md)
- [The Host question queue: selection poll, clear-all, and 72h TTL](how-to/BL-810-host-queue-selection-poll-clear-all-and-ttl.md)
- [Queued questions answer where they were asked](how-to/BL-767-queued-question-answers-in-origin-topic.md)
- [Named tunnel Bubble — fixed URL on a Cloudflare zone you own](how-to/named-tunnel-bubble-musicalsifu.md)
- [Running Bubble's JVM unit suite](how-to/BL-769-android-jvm-unit-suite.md) — which Kotlin logic is testable on the host JVM, and where the pure-logic/device-surface line falls.
- [babysitterd — the deterministic health-sweep daemon](how-to/BL-611-babysitterd-runbook.md) — what it checks, what a nudge looks like, start/stop/ensure, state layout, and the flipped env skip.
- [Provider auth-error auto-respawn: healing a wedged standing role](how-to/BL-536-provider-auth-error-auto-respawn.md) — how the chase sweep detects and heals an `AuthenticationError`-wedged role, the `auth_respawn_max_attempts` cap, and the operator alert.
- [The coordinator raises a clarifying question through `role_ask.bb`](how-to/BL-773-coordinator-role-ask-clarifying-question.md) — wiring the coordinator into the same per-role ask path the specifier already uses, so its questions reach Telegram instead of blocking on an unwatched surface.
- [`/pilot safe` — auto-pick a low-blast defect for offline pilot](how-to/BL-722-pilot-safe-defects.md) — the safe-pool filter (approved, low-mutation, specced defect, not needs_design), its ranking, and the empty-pool refusal.
- [Certifying an operator hotfix](how-to/BL-848-certify-an-operator-hotfix.md) — declaring a hand-landed hotfix with the `Hotfix-Certification: pending` trailer, the ledger state machine, and why no hotfix becomes an official swarm deal on green tests alone.
- [Master-Checkout Drift Alarm — Understanding the Alert](how-to/BL-839-master-checkout-drift-alarm.md) — what to do when the master checkout's daemon-executed scripts no longer match `main`.
- [Token-Burn Exhaustion Warning in the Morning Briefing](how-to/BL-619-token-burn-briefing-warning.md) — recording a usage-percentage anchor, what the warning looks like, the weekly-reset config, and troubleshooting a missing or wrong projection.
- [Bedtime vs. lights-out: which stop verb to run](how-to/BL-762-finish-shift-bedtime-vs-lights-out.md) — the keep-vs-kill table `./finish-shift` and `./stop-swarm.sh` both read, and why bedtime leaves the phone path up.
- [Diagnosing a wake with attribution records](how-to/BL-870-wake-attribution.md) — the `wake-attribution-<YYYY-MM>.jsonl` log every landed or skipped wake now writes, its fields, and how to read a false-wake report from it.
- [Hotfix record: 2026-08-02 Mac host-switch (freshness + bridge)](how-to/hotfix-2026-08-02-mac-host-switch-freshness-bridge.md) — the three false/misleading failure modes from the Linux→Mac host switch (handoffd reported down forever, babysitterd restart spam, bridge EADDRINUSE crash loop), adopted and reviewed under BL-789.
- [The Boot-Prefix Budget Gate — Understanding the Check](how-to/BL-859-boot-prefix-budget-gate.md) — the specifier's authoring-time gate against boot-prefix growth, the 44000/51200 two-threshold split, and remediation on failure.
- [The Bubble Settings voice-engine selector](how-to/BL-864-bubble-voice-engine-selector.md) — the Local/OpenAI control in Bubble Settings: opens on the truth, never shows a tap the bridge hasn't accepted, and where the pure state machine ends and device wiring begins.
- [Hotfix record: 2026-08-02 Bubble pairing + client-logs](how-to/hotfix-2026-08-02-bubble-client-logs-and-pairing.md) — the pre-auth `/pair` page, the widened sideload-APK guard, and the pairing-save blank-overwrite fix adopted and reviewed under BL-788, plus the corrections (applicationId, signing, Architecture Rule 7) the original hand-hotfix's narrative no longer matched.

## Reference

*Information-oriented: exhaustive, neutral descriptions of how things are.*

- [SwarmForge VS Code Extension — Specification](reference/Specification.MD)
- [docs-tree.json schema](reference/docs-tree-schema.md)
- [backlog.json schema](reference/backlog-dashboard-schema.md)
- [Mutation-run worker RSS measurement report](reference/BL-427-mutation-worker-rss-measurement.md)
- [Unit suite per-file duration profile (BL-792 baseline)](reference/BL-792-test-duration-profile.md) — the green-run measurement slice B's speed cuts are specced against.
- [BL-007 Spec: Backlog Panel](reference/specs/BL-007-spec.md)
- [BL-008 Spec: Named runs](reference/specs/BL-008-spec.md)
- [BL-009 Spec: Hardened Message Bus](reference/specs/BL-009-spec.md)
- [BL-010 Spec: Heartbeat Decorator](reference/specs/BL-010-spec.md)
- [BL-011 Spec: Watchdog](reference/specs/BL-011-spec.md)
- [BL-012 Spec: Chase and Dead-Letter Escalation](reference/specs/BL-012-spec.md)
- [M2 Specification — Reliability Layer](reference/specs/m2-spec.md)
- [Expeditor — complete reference](reference/BL-567-expeditor-manual.md) — every flag, exit code, artifact, verdict and refusal of the stack-stopped driver.
- [Build Freshness QA Approval Gate (BL-629)](reference/BL-629-build-freshness-qa-approval-gate.md) — the deploy-time gate preventing sync of pre-QA code to daemons.
- [Ticket Lifecycle Ledger (BL-819)](reference/BL-819-ticket-lifecycle-ledger.md) — the coordinator-owned, append-only per-ticket lifecycle record: event/snapshot schema, storage, idempotency, write points, and its boundary vs the coordinator's other duties.
- [Closing-Ceremony Lean Pass (BL-820)](reference/BL-820-closing-ceremony-lean-pass.md) — the shift-close step that folds BL-819's ledger into a packet, delivers it to the specifier, and records a coordinator adjustment / specifier outcome; storage, CLIs, and boundary.
- Architecture and swarm-flow diagrams: [architecture.mmd](diagrams/architecture.mmd), [swarm-flow.mmd](diagrams/swarm-flow.mmd) (Mermaid sources)
- [Non-Pipeline Agents — Reference Table](reference/BL-643-non-pipeline-agents-reference-table.md) — every launcher, stop path, role prompt (or its stated absence), log location, and supervising service, checked against the repo.

## Explanation

*Understanding-oriented: discursive background and rationale.*

- [SwarmForge VS Code Extension — Milestone Roadmap](explanation/Milestone%20Roadmap.MD)
- [Headless swarm + extension reattach (operator doctrine)](explanation/headless-reattach-doctrine.md)
- [Handoff dual-path delivery (tmux primary, mailbox backup)](explanation/handoff-dual-path.md)
- [Why the expeditor commands the stack but never depends on it](explanation/BL-567-why-the-expeditor-commands-the-stack-but-never-depends-on-it.md)
- [Lessons from 2026-07-25: green suites that proved nothing](explanation/lessons-2026-07-25-green-suites-that-proved-nothing.md) — six ways a passing test proved nothing, tools that lie about their own success, and what good diagnosis looked like.
- [The Non-Pipeline Agents, As a Class](explanation/BL-643-non-pipeline-agents-as-a-class.md) — what makes an agent non-pipeline, the taxonomy, and what the Onboarder actually ships today vs. its unbuilt phases.
