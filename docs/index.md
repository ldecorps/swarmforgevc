# Documentation Index

This project's docs follow the [Divio Documentation System](https://docs.divio.com/documentation-system/):
four modes, each serving a distinct reader need. Every authored doc below
lives under the mode that matches what a reader is trying to do with it.

Generated/asset directories that are not part of this classification —
`docs/archive/` (superseded material), `docs/briefings/` (daily briefing
artifacts), `docs/benchmarks/` (recorded benchmark data), `docs/i18n/`
(translation cache), `docs/roles-future/` (draft future-role prompts),
`docs/branding/` (design-exploration doc + image/generator assets, marked
not-yet-ratified at its own top), and `docs/diagrams/` (Mermaid sources,
linked from Reference below) — stay where the tooling that reads them
expects them, and are not migrated or rewritten here.

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
- [Host switchover doctor — the post-move checklist](how-to/BL-1057-host-switchover-doctor.md)
- [Verifying the stabilize-two-pack daemon-on workflow](how-to/BL-203-stabilize-two-pack-smoke-check.md)
- [Wiring the Phone Recert Inbound Address Live](how-to/BL-223-recert-inbound-address-golive.md)
- [Checking Pipeline Board Ticket Links](how-to/BL-513-pipeline-board-current-folder-links.md)
- [Using the Operator Telegram Console](how-to/BL-516-operator-telegram-console.md)
- [Answering the Swarm Offline](how-to/BL-441-answering-offline-runbook.md)
- [Bringing Up the FES Second Swarm (mono-rotate, own Telegram identity)](how-to/BL-439-fes-second-swarm-bringup.md)
- [Model Steward: Onboarding, Certification, and Role Recommendations](how-to/BL-547-model-steward-overview.md) — register / certify; **capture-then-evaluate** ingest (BL-556) for recruiter/bake-off evidence into capabilities, role-matrix pointers, and gated certification reports.
- [ModelFactory: Assigning and Applying Agent Models](how-to/BL-525-model-factory-assign-and-apply.md)
- [Pull and serve a named model on this host](how-to/BL-1082-pull-and-serve-a-named-model.md) — Ollama-backed `named-model` CLI: pull by id into `~/.swarmforge/models/ollama`, serve/reuse a loopback OpenAI-compatible endpoint, status that names the URL; Linux/WSL2 v1; seat staffing is BL-1052, routing BL-1053.
- [Staff a role seat with a downloaded local model](how-to/BL-1052-local-model-seat-launch.md) — agent token `local-model` + pack `local-model-mono-router` against the BL-1082 loopback endpoint; first-quest binary `qwen`; health refusal names the URL; second model id is a window-line change only; `qwen-mono-router` (aider) stays separate.
- [Route work to a local-model seat (intelligence layer)](how-to/BL-1053-route-work-to-a-local-model-seat.md) — Steward registration under provider `local` (cost class `low`); ModelFactory maps `local`→`local-model`; unknown providers fail loudly; a second on-host model is registration-only.
- [Wire Mistral Vibe into the Intelligence Layer](how-to/BL-682-mistral-vibe-intelligence-layer-routing.md) — ModelFactory maps `mistral`→`vibe`; Steward seeds `mistral/mistral-medium-3.5` from the live vibe config alias (registration only; packs/launchers unchanged).
- [Handling Pre-QA Gate Handoff Refusals](how-to/BL-531-handoff-refusal-remedies.md)
- [Understanding and Handling Sibling Bounce Deferrals](how-to/BL-532-sibling-bounce-deferral-runbook.md)
- [Context Telemetry: Recording and Querying Agent Invocations](how-to/GH-22-context-telemetry-recorder-and-query-cli.md)
- [Monitoring Agent Context Budget in the Mini App Console](how-to/GH-23-context-budget-dashboard.md)
- [Reviewing Paused Tickets in the Mini App Console](how-to/BL-538-console-paused-ticket-pager.md)
- [Let's Talk — Discrete Audio Turns in the Mini App Console](how-to/BL-696-miniapp-lets-talk-cursor-audio.md)
- [Telegram Cursor Remote operator commands](how-to/BL-698-telegram-cursor-operator-commands.md) — phone-first slash verbs on the Cursor Remote topic, danger tiers, and (BL-1113) CreatePlan **Confirm plan** / **Reject plan** progress buttons.
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
- [babysitterd — the deterministic health-sweep daemon](how-to/BL-611-babysitterd-runbook.md) — what it checks (including per-agent process markers, BL-1108), what a nudge looks like, start/stop/ensure, state layout, the flipped env skip, the Operator's tell-never-restart freshness watchdog (down/pidfile-lie/announce-mute/healthy), the bounded vanished-session repair, the bounded control-plane auto-heal (attempt/wall-clock bound, three-outcome REPAIR line), and the detector that tells someone when pipeline code lands on `main` outside QA.
- [Recovering from control-plane loss (tmux server gone, daemons still up)](how-to/BL-958-control-plane-loss-recovery.md) — how to recognise the shape, the single `control-plane` status row that replaces stale per-role DOWN rows, the incident artifact under `.swarmforge/incidents/`, `./swarm ensure`'s recover-or-halt paths, and why `babysitterd` owns the response.
- [Recovering from a crossed Pipeline Board topic, and cleaning up zombie topics](how-to/BL-586-pipeline-board-topic-identity-runbook.md) — diagnosing a crossed identity post-BL-586, why the 2026-07-23 stack-down repair procedure is now legacy, and the manual zombie-topic cleanup the Bot API cannot do for you.
- [Provider auth-error auto-respawn: healing a wedged standing role](how-to/BL-536-provider-auth-error-auto-respawn.md) — how the chase sweep detects and heals an `AuthenticationError`-wedged role, the `auth_respawn_max_attempts` cap, and the operator alert.
- [The coordinator raises a clarifying question through `role_ask.bb`](how-to/BL-773-coordinator-role-ask-clarifying-question.md) — wiring the coordinator into the same per-role ask path the specifier already uses, so its questions reach Telegram instead of blocking on an unwatched surface.
- [`/pilot safe` — auto-pick a low-blast defect for offline pilot](how-to/BL-722-pilot-safe-defects.md) — the safe-pool filter (approved, low-mutation, specced defect, not needs_design), its ranking, and the empty-pool refusal.
- [Certifying an operator hotfix](how-to/BL-848-certify-an-operator-hotfix.md) — declaring a hand-landed hotfix with the `Hotfix-Certification: pending` trailer, the ledger state machine, and why no hotfix becomes an official swarm deal on green tests alone.
- [Master-Checkout Drift Alarm — Understanding the Alert](how-to/BL-839-master-checkout-drift-alarm.md) — what to do when the master checkout's daemon-executed scripts no longer match `main`.
- [Master-Main Reconcile Sweep — Understanding the Note](how-to/BL-891-master-main-reconcile-sweep.md) — the cadence sweep that merges `origin/main` forward into the master checkout's local `main` ref, what to do when it surfaces a dirty-overlap-or-conflict note, and (BL-1113) the coordinator step-0 `main_sync_status_cli` gate plus trip-once deadlock that suppresses drop-nudges until `behind=0`.
- [Token-Burn Exhaustion Warning in the Morning Briefing](how-to/BL-619-token-burn-briefing-warning.md) — recording a usage-percentage anchor, what the warning looks like, the weekly-reset config, and troubleshooting a missing or wrong projection.
- [Bedtime vs. lights-out: which stop verb to run](how-to/BL-762-finish-shift-bedtime-vs-lights-out.md) — the keep-vs-kill table `./finish-shift` and `./stop-swarm.sh` both read, and why bedtime leaves the phone path up.
- [Diagnosing a wake with attribution records](how-to/BL-870-wake-attribution.md) — the `wake-attribution-<YYYY-MM>.jsonl` log every landed or skipped wake now writes, its fields, and how to read a false-wake report from it.
- [Hotfix record: 2026-08-02 Mac host-switch (freshness + bridge)](how-to/hotfix-2026-08-02-mac-host-switch-freshness-bridge.md) — the three false/misleading failure modes from the Linux→Mac host switch (handoffd reported down forever, babysitterd restart spam, bridge EADDRINUSE crash loop), adopted and reviewed under BL-789.
- [The Boot-Prefix Budget Gate — Understanding the Check](how-to/BL-859-boot-prefix-budget-gate.md) — the specifier's authoring-time gate against boot-prefix growth, the 44000/51200 two-threshold split, and remediation on failure.
- [The Bubble Settings voice-engine selector](how-to/BL-864-bubble-voice-engine-selector.md) — the Local/OpenAI control in Bubble Settings: opens on the truth, never shows a tap the bridge hasn't accepted, and where the pure state machine ends and device wiring begins.
- [Hotfix record: 2026-08-02 Bubble pairing + client-logs](how-to/hotfix-2026-08-02-bubble-client-logs-and-pairing.md) — the pre-auth `/pair` page, the widened sideload-APK guard, and the pairing-save blank-overwrite fix adopted and reviewed under BL-788, plus the corrections (applicationId, signing, Architecture Rule 7) the original hand-hotfix's narrative no longer matched.
- [Remote-control health/respawn tooling, and its `./swarm ensure` wiring](how-to/BL-514-remote-control-health-and-ensure-wiring.md) — the `--fix`/`--dry-run` standalone scripts (retro-ticketed, KEEP), the `rc:<role>` component beside `agent:<role>`, and (BL-1108) agent-aware absent-flag reporting: Claude with no `--remote-control` stays HEALTHY; Cursor/other non-Claude report `OFF` instead of a misleading HEALTHY.
- [Bubble's capability flags and hold-music catalog, served from the bridge](how-to/BL-765-bubble-remote-config-and-chiptune-catalog.md) — the two versioned documents (`bubble-config.json`, `chiptunes.json`), whole-document rejection on a malformed payload, the remote hold-music kill switch, and the reply-voice/music-volume split.
- [Bare-host bootstrap for an autonomous swarm](how-to/BL-628-autonomous-swarm-bringup.md) — `provision_autonomous_host.sh`, the shared shape-agnostic bootstrap library, the front-desk unit an autonomous box needs that the secondary path never installs, and why the onboarding ceremony runs on the primary box, never the remote one.
- [One briefing send, one backlog history walk: the shared lifecycle snapshot](how-to/BL-897-briefing-lifecycle-snapshot.md) — the machine-local, gitignored snapshot handoffd gathers once per UTC day and hands every briefing-section CLI via `--snapshot`, and the per-consumer fallback when it's missing, unreadable, or stale.
- [The Morning Briefing's Open-Ticket Chart](how-to/BL-896-briefing-open-ticket-chart.md) — what the chart shows, why its heading keeps the word "burndown" per an explicit human ruling despite BL-659's ban elsewhere, the projected-ETA caption and how to recompute it by hand (and why a growing backlog states a reason instead of a date), and its fail-open independence from the architecture diagram section.
- [Bubble caches the bridge's companion packages, offline-first](how-to/BL-907-bubble-offline-package-sync.md) — the pure sync/cache decision layer, the atomic per-package file store, the two BL-654 invariants, and the manual device procedure that verifies the storage/lifecycle wiring the JVM suite can't reach.
- [Bubble's browsable knowledge screen — backlog and docs panels](how-to/BL-908-bubble-knowledge-screen-backlog-docs-panels.md) — the read-only backlog/docs panels over what BL-907 holds on the device, the generation stamped on every Ready view, and the permanent header sync trigger that replaced the empty-state-only button.
- [Running a >120s job that survives the orphan reaper](how-to/BL-995-detached-job-registry.md) — `detach_job.sh`, the single sanctioned escape hatch for jobs over the Bash tool's ~120s cap, its detach-registration registry, and why a registered job is still reaped once its registration expires.
- [Bubble decides which UI bundle to render, without ever losing Talk](how-to/BL-825-bubble-remote-ui-bundle-resolution.md) — the four-outcome resolver (fresh/cached/stale/bare) behind the coming remote-UI pager screens, the shell-behind refusal that never renders a bundle the installed APK can't honour, and the whole-or-nothing manifest parsing on both the bridge and the phone.
- [Bubble's pager renders the bundle's pages, without ever stranding Talk](how-to/BL-829-bubble-remote-page-pager.md) — the manifest's new `pages` list, the pure `PagerListResolver` allowlist/degraded-state decision, the `RemotePageHost` WebView edge that never shows a blank failure, and the `TalkPanelActivity`/`MainActivity` wiring correction to the ticket's own `required_wiring`.
- [Pinned Shell + One Classified Retry (Tool-Miss Auto-Heal, Slice A)](how-to/BL-913-pinned-shell-and-tool-miss-auto-heal.md) — the `PreToolUse` hook that pins every role's Bash command to its own worktree and heals one recoverable miss (wrong-cwd, wrong-surface, missing-root-argv) in silence before the model ever sees a failure, versus a real failure returned untouched.
- [The Batch-Claim Progress Sidecar](how-to/BL-678-batch-claim-progress-sidecar.md) — the live-owner half of BL-648's source near-miss: the sidecar every batch claim now writes at claim time, the chase sweep that refreshes it and surfaces (never re-forwards or re-delivers) a stale one to the coordinator, the staleness/cooldown config knobs, and (BL-1076) per-role thresholds plus the dirty-worktree suppression gate.
- [The Reference-Freshness Pre-Turn Guard](how-to/BL-640-reference-freshness-guard.md) — why `ready_for_next.sh` can now refuse a turn with `STALE_REFERENCE_ELABORATION`, what it checks (worktree vs. whichever of `main`/`origin/main` is ahead), and what to do when it fires.
- [Clearing Byte-Identical Hot-Synced Copies Before a Worktree Merge](how-to/BL-924-clear-identical-untracked-copies-before-merge.md) — the `clear_identical_untracked_and_merge.bb` script to run instead of a bare `git merge` when untracked, hot-synced script copies block a worktree fast-forward, its all-or-nothing identity proof, and what it deliberately never touches.
- [Keeping the operator_runtime.bb JS fixture list honest](how-to/BL-944-operator-runtime-fixture-closure-guard.md) — the source-derived load-file closure guard that replaced a six-times-drifted hand-maintained list, how to add a new dependency without repeating the drift, and how this differs from BL-671's separate shell-fixture sandbox.
- [The Constitution Doc-Citation Guard](how-to/BL-945-constitution-doc-citation-guard.md) — why a constitution article citing a `docs/...` path now fails the standing extension suite if that path doesn't resolve on `main`, what it deliberately does and doesn't scan, and how it differs from BL-640's worktree-freshness guard.
- [The Hardening-Debt Ledger](how-to/BL-942-hardening-debt-ledger.md) — why the office-hours mutation/CRAP bypass's "runs later against a quiet host" promise can no longer be kept under continuous 3x8 shifts, how to record a deferral and read outstanding debt, and its dedup/no-row-on-success rules.
- [Running the APS candidate-toolchain equivalence harness](how-to/BL-959-aps-candidate-toolchain-equivalence-run.md) — how to measure a candidate APS toolchain against the pinned one before a human pin bump: the clone-at-SHA-and-verify run, the three gate lanes and their EQUIVALENT/DIVERGENT/INCOMPLETE matrix, the fail-closed exit, the `--do-not-infer` shim seam, and the pinned surfaces it never writes.
- [Diagnosing a handoffd cycle stall from the log](how-to/BL-967-handoffd-cycle-stall-diagnosis.md) — how to read `sweep-boundary` and `subprocess-timeout` lines when the daemon goes quiet mid-cycle, the 60s bounded-subprocess chokepoint and its `SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS` seam, why raising the freshness threshold is not a fix, and why a slow 120–232s cycle is healthy rather than stalled.
- [The operator-runtime watch — an always-on supervisor for `operator_runtime.bb`](how-to/BL-993-operator-runtime-watch.md) — the tell-and-restart watch that closes the "nothing notices a crashed operator runtime" gap: the shared liveness check, the park-flag/skip-env deliberate-stop signals, bounded restart with backoff, human-channel announcements, and why the watcher must never depend on the runtime it watches.
- [Cross-seat rework claim deferral](how-to/BL-1004-cross-seat-rework-claim-deferral.md) — why a multi-seat stage now defers a rework to the sibling seat that built it, the bounded `cross_seat_claim_deadline_ms` wait and the out-loud cross-seat claim past it, why single-seat stages are structurally untouched, and how the flow watchdog/chase sweep avoid a false stuck-parcel alarm mid-window.
- [Rescuing orphaned work with `rescue_orphaned_work.bb`](how-to/BL-1041-rescue-orphaned-work.md) — the commit-verify-then-release ordering that stops a rescue from losing the thing it rescued, why the changed-path set is read from the stash and not the receiving tree, the capped owner notification, and its boundary against `salvage_lib.bb`.
- [Five guarded fixture copy-lists, and a standing test-suite inventory](how-to/BL-973-bb-fixture-closure-guards-and-suite-inventory.md) — extending BL-944's closure-derived discipline to the other four bb fixture copy-lists (read behaviorally, never by source grep), the standing `run_bb_suite.sh`/`suite-manifest.tsv` inventory gate that closes the "a red test sits unrun and unnoticed" gap, and how to add a new load-file dependency or test file without re-rotting either.
- [Role panes stop inheriting every provider secret](how-to/BL-1049-provider-secret-scrub-from-role-panes.md) — the BL-657 tmux-server scrub's new provider-secret half: the configuration-derived keep-list, the launcher-vs-server separation invariant that protects `handoffd`'s briefing email, and the fail-open posture on both an unreadable conf and an unrecognized backend.
- [WSL tmux control-plane segfault — upgrade to ≥ 3.7](how-to/BL-tmux-wsl-segfault-upgrade.md) — the Ubuntu tmux 3.4 NULL-window segfault (`resize.c`, fault at 0x208) that crash-loops the control plane on WSL, the no-root `~/.local/bin` install with digest verification (BL-1069), and bouncing the live server so the fix reaches the *server*, not just the client on PATH.
- [Driving one pipeline seat with a Cursor agent (the spike CLI)](how-to/BL-713-cursor-seat-driver-spike.md) — `cursor-seat-spike`'s flags and exit codes, the spike-only certification escape that admits an uncertified identity for one run, and the boundary against the landed `cursor` launcher token (BL-1078) and landed steward certification (BL-1079).
- [Certifying a Cursor identity, and the residuals that stay after the gate](how-to/BL-1079-cursor-identity-steward-certify-and-residuals.md) — scorecard-backed `certify` for `cursor/auto`, plus bootstrap limits, why Cursor seats do not get Claude `/rc`, and cost attribution under provider `cursor`.
- [Barge-in: stopping Bubble's speech when the human talks over it](how-to/BL-777-barge-in-detector-and-playback-abort.md) — the pure `BargeInDetector` state machine's onset/self-output/session-count invariants, its tuning constants, the `TalkEngine`/`ReplyAudioPlayer` device wiring, and the manual device procedure that verifies it.
- [The hands-free session state machine: wake once, talk, then go quiet](how-to/BL-844-hands-free-session-state-machine.md) — the `PassiveWake`/`ActiveListen`/`Thinking`/`Speaking` states, the 10-second silence window, why a soft closer doesn't restart it while a hard end phrase skips it, the barge-in/push-to-talk interactions, and the manual device procedure.
- ["Hey Bubble" — offline, on-device wake spotting](how-to/BL-845-offline-hey-bubble-wake.md) — why the stock cloud-backed `SpeechRecognizer` is unusable for this path, the injected-and-not-yet-chosen spotter engine, the phrase-never-travels and network-silent-passive invariants, the derived-not-hand-assigned colour table, and the manual device procedure.

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
- [Commit-Time Guard Refuses Pipeline Code on Main (BL-632)](reference/BL-632-commit-time-guard-refuses-pipeline-code-on-main.md) — the pre-commit/pre-merge-commit hooks that stop a non-QA role from putting pipeline code on `main` in the first place.
- [Ticket Lifecycle Ledger (BL-819)](reference/BL-819-ticket-lifecycle-ledger.md) — the coordinator-owned, append-only per-ticket lifecycle record: event/snapshot schema, storage, idempotency, write points, and its boundary vs the coordinator's other duties.
- [Closing-Ceremony Lean Pass (BL-820)](reference/BL-820-closing-ceremony-lean-pass.md) — the shift-close step that folds BL-819's ledger into a packet, delivers it to the specifier, and records a coordinator adjustment / specifier outcome; storage, CLIs, and boundary.
- Architecture and swarm-flow diagrams: [architecture.mmd](diagrams/architecture.mmd), [swarm-flow.mmd](diagrams/swarm-flow.mmd) (Mermaid sources)
- [Non-Pipeline Agents — Reference Table](reference/BL-643-non-pipeline-agents-reference-table.md) — every launcher, stop path, role prompt (or its stated absence), log location, and supervising service, checked against the repo.
- [Fixture Tmux-Server Reaper Adoption (BL-817)](reference/BL-817-fixture-tmux-server-reaper-adoption.md) — the seven step-handler files that now register their fixture tmux servers with the shared `fixtureReaper`, the socket-path-only kill guardrail, and the standing `tmuxReaperGuard` gate that catches the idiom returning.
- [Socket-Fixture Short Root and Its Gate (BL-948)](reference/BL-948-socket-fixture-short-root-and-gate.md) — the shared short-base fixture-root helper for socket-building step files, its headroom assertion and exit-hook backstop, and the by-inspection gate (plus BL-897 parity test) that stops the long-base root returning.
- [Retired `SWARMFORGE_ENSURE_*` Env-Var Regression Gate (BL-964)](reference/BL-964-retired-ensure-env-var-regression-gate.md) — the standing gate that fails loud when a retired ensure-hook env-var name reappears in test code, with a needle set derived from `swarm_ensure.bb`'s own reads rather than a hand-written roster.
- [Boy Scout Scan (BL-1014)](reference/BL-1014-boy-scout-scan.md) — the on-demand, read-only CLI that ranks technical debt by cross-source recurrence across five evidence sources, with an evidence pointer per item; slice 1 of the `boy-scout` epic.
- [Boy Scout Run (BL-1015)](reference/BL-1015-boy-scout-run.md) — the acting half: applies an already-written proposal for the scan's top-ranked item inside a declared size envelope, verified against the repository's existing gate set and committed, or refuses the whole thing and states why; slice 2 of the `boy-scout` epic.
- [Pinned-Repo Fixture and the Live-Derivation Guard (BL-1038)](reference/BL-1038-pinned-repo-fixture-and-live-derivation-guard.md) — the dependency-closure fixture that replaces whole-directory copies of the live `swarmforge/scripts/`, the guard that catches both direct and indirect (escapes-into-production) live-repository reads, and its six scoped exemptions.
- [Shared Git-Repo Fixture and Its Guard (BL-1039)](reference/BL-1039-shared-git-repo-fixture.md) — the seed-once template that replaces per-test `git init`/`config`/`commit` in the unit lane, its structural isolation, the by-inspection creation guard and its three scoped exemptions.
- [ACP-Hosted Seat Snapshot (BL-1081)](reference/BL-1081-acp-hosted-seat-snapshot.md) — the `.swarmforge/acp/<role>.json` schema, the provider-table `:acp` dimension, which babysitter checks change for a hosted seat, the `acp-host-pane` CLI, and the production launcher that puts the `vibe` spike seat behind the host.
## Explanation

*Understanding-oriented: discursive background and rationale.*

- [SwarmForge VS Code Extension — Milestone Roadmap](explanation/Milestone%20Roadmap.MD)
- [Headless swarm + extension reattach (operator doctrine)](explanation/headless-reattach-doctrine.md)
- [Handoff dual-path delivery (tmux primary, mailbox backup)](explanation/handoff-dual-path.md)
- [Why the expeditor commands the stack but never depends on it](explanation/BL-567-why-the-expeditor-commands-the-stack-but-never-depends-on-it.md)
- [Lessons from 2026-07-25: green suites that proved nothing](explanation/lessons-2026-07-25-green-suites-that-proved-nothing.md) — six ways a passing test proved nothing, tools that lie about their own success, and what good diagnosis looked like.
- [The Non-Pipeline Agents, As a Class](explanation/BL-643-non-pipeline-agents-as-a-class.md) — what makes an agent non-pipeline, the taxonomy, and what the Onboarder's three shipped slices actually do.
- [Why Promotion Ranks by Epic Priority Before Ticket Priority](explanation/BL-900-epic-priority-promotion-ranking.md) — the rank-key shape, the epic-priority lookup and its fallbacks, and why expedited defects, queue-jump, and ambulance mode are untouched.
