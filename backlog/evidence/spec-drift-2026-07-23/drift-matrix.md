# Spec/doc drift matrix — 2026-07-15 → 2026-07-23

Out-of-band = no `By <role>` swarm trailer. Classes: cursor / session (direct Claude Code) / human (Laurent) / unattributed.

## Summary

| class | commits |
|---|---|
| oob-cursor | 53 |
| oob-human | 4 |
| oob-session | 3 |
| oob-unattributed | 65 |
| swarm | 363 |
| swarm-plumbing | 113 |

## Source files touched out-of-band (most-churned first)

| file | OOB commits | streams | implicated features | implicated docs | SPEC-LESS |
|---|---|---|---|---|---|
| extension/src/bridge/residentSpyUiHtml.ts | 20 | oob-session, oob-cursor, oob-unattributed | — | — | **YES** |
| swarmforge/scripts/swarmforge.sh | 20 | oob-cursor, oob-unattributed | (generic stem "swarmforge" — 129 feature / 39 doc hits; map manually) | — |  |
| swarmforge/scripts/handoffd.bb | 19 | oob-session, oob-cursor, oob-unattributed | (generic stem "handoffd" — 18 feature / 10 doc hits; map manually) | — |  |
| extension/src/bridge/bridgeServer.ts | 12 | oob-cursor, oob-unattributed | BL-538-console-paused-ticket-pager.feature<br>GH-23-context-budget-dashboard.feature<br>BL-369-no-inbound-message-is-ever-lost.feature<br>BL-320-reply-relay-at-least-once.feature | docs/briefings/2026-07-11.md |  |
| extension/src/concierge/conciergeTick.ts | 12 | oob-cursor, oob-unattributed | BL-453-concierge-front-desk-icon-label.feature<br>BL-434-approvals-standing-topic.feature<br>BL-473-pipeline-board-shows-every-active-ticket.feature<br>BL-465-pipeline-board-render-round2.feature<br>BL-450-recert-standing-telegram-topic.feature<br>BL-497-pipeline-board-post-failure-recovery.feature<br>BL-455-pipeline-board-epic-grouping-parked-slug.feature<br>BL-464-pipeline-board-authoritative-stage-source.feature<br>BL-480-approval-ask-content.feature<br>BL-513-pipeline-board-links-grid-only-alphabetical.feature<br>BL-452-pipeline-board-telegram-topic.feature<br>BL-467-pipeline-board-only-pin.feature<br>BL-462-pipeline-board-wider-slug-updated-at-repost.feature | — |  |
| extension/src/concierge/residentPaneSpy.ts | 12 | oob-cursor, oob-unattributed | — | — | **YES** |
| swarmforge/scripts/handoff_lib.bb | 12 | oob-cursor, oob-unattributed | BL-448-mono-rotate-pack.feature<br>BL-499-chase-sweep-rechases-resolved-new-duplicate.feature | — |  |
| swarmforge/scripts/swarm_ensure.bb | 11 | oob-cursor, oob-unattributed | BL-463-mutation-cooldown-gate-ignores-own-parcel-commits.feature<br>BL-461-start-swarm-ensure-full-stack.feature<br>BL-361-linux-dev-host-launcher.feature | — |  |
| extension/src/bridge/residentPaneLive.ts | 9 | oob-cursor, oob-unattributed | — | — | **YES** |
| extension/src/concierge/pipelineBoard.ts | 9 | oob-cursor, oob-unattributed | BL-502-pipeline-board-message-length-budget.feature<br>BL-473-pipeline-board-shows-every-active-ticket.feature<br>BL-468-pipeline-board-post-before-delete.feature<br>BL-465-pipeline-board-render-round2.feature<br>BL-497-pipeline-board-post-failure-recovery.feature<br>BL-455-pipeline-board-epic-grouping-parked-slug.feature<br>BL-508-pipeline-board-updated-at-uk-time.feature<br>BL-464-pipeline-board-authoritative-stage-source.feature<br>BL-513-pipeline-board-links-grid-only-alphabetical.feature<br>BL-452-pipeline-board-telegram-topic.feature<br>BL-507-pipeline-board-drop-coordinator-column.feature<br>BL-467-pipeline-board-only-pin.feature<br>BL-462-pipeline-board-wider-slug-updated-at-repost.feature | docs/briefings/2026-07-23.md |  |
| extension/src/tools/telegram-front-desk-bot.ts | 9 | oob-cursor, oob-unattributed | BL-453-concierge-front-desk-icon-label.feature<br>BL-450-recert-standing-telegram-topic.feature<br>BL-509-amend-button-steers-ticket.feature<br>BL-452-pipeline-board-telegram-topic.feature<br>BL-467-pipeline-board-only-pin.feature | — |  |
| swarmforge/scripts/chase_sweep_lib.bb | 9 | oob-cursor, oob-unattributed | BL-209-wire-rate-limit-cooldown-detection.feature<br>BL-504-ts-metrics-ticket-id-extractor-allowlist-hyphen-optional.feature<br>BL-503-ticket-id-extractor-hyphen-optional.feature<br>BL-499-chase-sweep-rechases-resolved-new-duplicate.feature | — |  |
| extension/src/tools/telegramFrontDeskBotCore.ts | 8 | oob-cursor, oob-unattributed | BL-453-concierge-front-desk-icon-label.feature<br>BL-434-approvals-standing-topic.feature<br>BL-450-recert-standing-telegram-topic.feature<br>BL-369-no-inbound-message-is-ever-lost.feature<br>BL-509-amend-button-steers-ticket.feature<br>BL-379-front-desk-listens-only-to-its-own-chat.feature | — |  |
| extension/src/tools/notify-resident-spy-tunnel.ts | 7 | oob-cursor, oob-unattributed | — | — | **YES** |
| extension/src/concierge/pipelineBoardSync.ts | 6 | oob-cursor, oob-unattributed | BL-468-pipeline-board-post-before-delete.feature<br>BL-497-pipeline-board-post-failure-recovery.feature<br>BL-508-pipeline-board-updated-at-uk-time.feature<br>BL-513-pipeline-board-links-grid-only-alphabetical.feature<br>BL-452-pipeline-board-telegram-topic.feature<br>BL-467-pipeline-board-only-pin.feature<br>BL-462-pipeline-board-wider-slug-updated-at-repost.feature | — |  |
| swarmforge/scripts/dispatch_lib.bb | 6 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/done_with_current_task.bb | 6 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/mono_router_lib.bb | 6 | oob-session, oob-cursor, oob-unattributed | — | — | **YES** |
| extension/src/bridge/consoleMenuUiHtml.ts | 5 | oob-cursor, oob-unattributed | — | — | **YES** |
| extension/src/bridge/pausedPagerUiHtml.ts | 5 | oob-cursor, oob-unattributed | — | — | **YES** |
| swarmforge/scripts/agent_runtime_lib.bb | 5 | oob-cursor, oob-unattributed | BL-206-fork-provider-capability-lifecycle-contract.feature<br>BL-546-prompt-engine-model-aware-prompt-composition.feature<br>BL-142-agent-brand-abstraction-layer.feature | — |  |
| swarmforge/scripts/launch_babysitter.sh | 5 | oob-cursor, oob-unattributed | — | — | **YES** |
| swarmforge/scripts/ready_for_next_batch.bb | 5 | oob-cursor, oob-unattributed | BL-226-remove-dead-promote-in-ready-for-next.feature | — |  |
| swarmforge/scripts/ready_for_next_task.bb | 5 | oob-cursor, oob-unattributed | BL-226-remove-dead-promote-in-ready-for-next.feature | — |  |
| extension/src/concierge/pipelineBoardPinSync.ts | 4 | oob-cursor, oob-unattributed | BL-467-pipeline-board-only-pin.feature | — |  |
| extension/src/concierge/residentSpyTunnelNotify.ts | 4 | oob-cursor | — | — | **YES** |
| extension/src/notify/telegramClient.ts | 4 | oob-cursor | BL-466-agent-questions-as-telegram-polls.feature<br>BL-452-pipeline-board-telegram-topic.feature<br>BL-467-pipeline-board-only-pin.feature<br>BL-462-pipeline-board-wider-slug-updated-at-repost.feature<br>BL-379-front-desk-listens-only-to-its-own-chat.feature | — |  |
| swarmforge/scripts/done_with_current_batch.bb | 4 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/failover_to_gpt.sh | 4 | oob-cursor, oob-unattributed | BL-525-model-factory-role-model-assignment.feature | — |  |
| swarmforge/scripts/babysitter_lib.bb | 3 | oob-cursor, oob-unattributed | — | — | **YES** |
| swarmforge/scripts/gherkin_lint_gate.sh | 3 | oob-unattributed | BL-515-gherkin-lint-rejects-wrapped-step.feature<br>BL-520-rewrap-legacy-wrapped-steps.feature<br>BL-231-swarm-compliance-battery.feature | docs/tutorials/Onboarding-New-Project.md |  |
| swarmforge/scripts/gherkin_lint_gate_cli.bb | 3 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/gherkin_lint_gate_legacy_wraps.txt | 3 | oob-unattributed | BL-520-rewrap-legacy-wrapped-steps.feature | — |  |
| swarmforge/scripts/gherkin_lint_gate_lib.bb | 3 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/operator_runtime.bb | 3 | oob-cursor | BL-466-agent-questions-as-telegram-polls.feature<br>BL-516-operator-telegram-console.feature<br>BL-366-systemd-units-can-actually-start.feature<br>BL-511-telegram-bridge-cost-briefing.feature<br>BL-351-front-desk-survives-reboot.feature<br>BL-433-build-freshness-operator-restart-race.feature<br>BL-369-no-inbound-message-is-ever-lost.feature<br>BL-509-amend-button-steers-ticket.feature<br>BL-460-tmp-sweeps-bound-deletes-not-scan.feature | docs/how-to/BL-101-pi-vps-secondary-swarm-bringup.md<br>docs/briefings/2026-07-22.md<br>docs/briefings/2026-07-12.md<br>docs/briefings/2026-07-20.md<br>docs/briefings/2026-07-16.md |  |
| swarmforge/scripts/provider_compat_lib.bb | 3 | oob-cursor, oob-unattributed | BL-525-model-factory-role-model-assignment.feature | — |  |
| swarmforge/scripts/start_babysitter.sh | 3 | oob-cursor, oob-unattributed | — | — | **YES** |
| extension/src/bridge/bridgeAuth.ts | 2 | oob-cursor, oob-unattributed | — | — | **YES** |
| extension/src/bridge/pipelineGridLive.ts | 2 | oob-cursor | — | — | **YES** |
| extension/src/bridge/pipelineGridUiHtml.ts | 2 | oob-cursor | — | — | **YES** |
| extension/src/metrics/llmCostLedger.ts | 2 | oob-cursor | — | — | **YES** |
| extension/src/panel/paneTailer.ts | 2 | oob-unattributed | BL-362-hot-test-files-stop-waiting.feature<br>BL-210-paneTailer-emitActivityEvents-crap.feature<br>BL-377-tmux-double-answers-in-process.feature | — |  |
| extension/src/swarm/backendSwitch.ts | 2 | oob-cursor, oob-unattributed | — | — | **YES** |
| extension/src/swarm/modelDisplayName.ts | 2 | oob-cursor, oob-unattributed | — | — | **YES** |
| extension/src/swarm/swarmLauncher.ts | 2 | oob-unattributed | BL-116-launch-path-probe-and-log.feature<br>BL-377-tmux-double-answers-in-process.feature | docs/reference/specs/BL-008-spec.md |  |
| extension/src/swarm/tmuxClient.ts | 2 | oob-unattributed | BL-376-respawn-backoff-waits-on-injected-clock.feature<br>BL-264-wire-resource-sampler-activation.feature<br>BL-377-tmux-double-answers-in-process.feature | — |  |
| extension/src/tools/heartbeat.ts | 2 | oob-human, oob-unattributed | BL-437-fleet-status-publish.feature<br>BL-411-negotiation-relay-supervisor-kills-superseded-child.feature<br>BL-368-control-loss-is-not-agent-death.feature<br>BL-328-merged-code-reaches-running-daemons.feature | docs/how-to/BL-203-stabilize-two-pack-smoke-check.md<br>docs/archive/bootstrap-brief.md<br>docs/index.md<br>docs/tutorials/GettingStarted.md<br>docs/tutorials/Onboarding-New-Project.md<br>docs/reference/specs/m2-spec.md<br>docs/reference/specs/BL-010-spec.md<br>docs/reference/specs/BL-011-spec.md<br>docs/reference/specs/BL-012-spec.md |  |
| extension/src/tools/swarm-cost-rank.ts | 2 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/babysitter_assess_lib.bb | 2 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/babysitter_runtime.bb | 2 | oob-cursor, oob-unattributed | — | — | **YES** |
| swarmforge/scripts/backlog_epic_milestone_audit.bb | 2 | oob-cursor, oob-unattributed | BL-544-specifier-epic-milestone-hygiene.feature | — |  |
| swarmforge/scripts/cache_warm_lib.bb | 2 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/claim_progress_lib.bb | 2 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/front_desk_supervisor.bb | 2 | oob-cursor, oob-session | BL-516-operator-telegram-console.feature<br>BL-436-per-swarm-telegram-creds.feature<br>BL-458-acceptance-fixture-process-leak.feature | docs/tutorials/Onboarding-New-Project.md |  |
| swarmforge/scripts/front_desk_supervisor_lib.bb | 2 | oob-cursor, oob-session | — | — | **YES** |
| swarmforge/scripts/handoff_inject_lib.bb | 2 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/launch_resident_spy_tunnel.sh | 2 | oob-cursor, oob-unattributed | — | — | **YES** |
| swarmforge/scripts/loop_detect_lib.bb | 2 | oob-unattributed | — | docs/briefings/2026-07-19.md |  |
| swarmforge/scripts/promote_and_route_next.sh | 2 | oob-unattributed | — | docs/briefings/2026-07-22.md<br>docs/briefings/2026-07-20.md |  |
| swarmforge/scripts/prompt_engine_cli.bb | 2 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/prompt_engine_lib.bb | 2 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/ready_for_next.sh | 2 | oob-cursor, oob-unattributed | BL-550-mono-router-stuck-after-merge-up-note.feature<br>BL-216-backlog-depth-reads-wrong-conf-and-breaks-no-limit-sentinel.feature<br>BL-231-swarm-compliance-battery.feature<br>BL-092-remote-wakeup-bridge-actions-runner.feature<br>BL-529-ticket-branch-mismatch-guard.feature<br>BL-226-remove-dead-promote-in-ready-for-next.feature<br>BL-323-resume-orphaned-inprocess-parcel.feature | docs/how-to/perplexity-mono-router-launch.md<br>docs/how-to/BL-091-wsl2-second-swarm-bringup.md<br>docs/explanation/handoff-dual-path.md<br>docs/briefings/2026-07-22.md<br>docs/briefings/2026-07-23.md<br>docs/briefings/2026-07-19.md<br>docs/briefings/2026-07-20.md<br>docs/reference/recurring-failure-mode-audit.md<br>docs/reference/specs/BL-011-spec.md |  |
| swarmforge/scripts/route_backlog_to_coder.sh | 2 | oob-cursor, oob-unattributed | — | docs/briefings/2026-07-18.md |  |
| swarmforge/scripts/start_ancillary_services.sh | 2 | oob-cursor, oob-unattributed | BL-461-start-swarm-ensure-full-stack.feature | — |  |
| swarmforge/scripts/swarm_attach.sh | 2 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/swarm_handoff.bb | 2 | oob-cursor | BL-216-backlog-depth-reads-wrong-conf-and-breaks-no-limit-sentinel.feature<br>BL-231-swarm-compliance-battery.feature | docs/explanation/headless-reattach-doctrine.md<br>docs/explanation/handoff-dual-path.md<br>docs/reference/specs/BL-009-spec.md |  |
| swarmforge/scripts/swarm_status.bb | 2 | oob-unattributed | BL-244-swarm-is-a-composite-node.feature | — |  |
| extension/src/bridge/holisticUiHtml.ts | 1 | oob-unattributed | BL-252-suite-duration-trend-holistic-briefing.feature<br>BL-257-pwa-enrichment.feature | — |  |
| extension/src/concierge/approvalAskClosing.ts | 1 | oob-cursor | — | — | **YES** |
| extension/src/concierge/approvalAskMore.ts | 1 | oob-cursor | — | — | **YES** |
| extension/src/concierge/approvalAskReconcile.ts | 1 | oob-cursor | — | — | **YES** |
| extension/src/concierge/conciergeTickRequest.ts | 1 | oob-cursor | — | — | **YES** |
| extension/src/concierge/conciergeTickScheduler.ts | 1 | oob-cursor | — | — | **YES** |
| extension/src/concierge/decidedApprovalAskCloseReconcile.ts | 1 | oob-cursor | — | — | **YES** |
| extension/src/concierge/editInPlaceMessageSync.ts | 1 | oob-cursor | BL-462-pipeline-board-wider-slug-updated-at-repost.feature | — |  |
| extension/src/concierge/epicIcon.ts | 1 | oob-unattributed | — | — | **YES** |
| extension/src/concierge/pendingApprovalReply.ts | 1 | oob-cursor | BL-480-approval-ask-content.feature<br>BL-509-amend-button-steers-ticket.feature | — |  |
| extension/src/concierge/topicRouter.ts | 1 | oob-cursor | BL-480-approval-ask-content.feature | — |  |
| extension/src/metrics/claimHealer.ts | 1 | oob-human | — | — | **YES** |
| extension/src/metrics/claimLiveness.ts | 1 | oob-human | — | — | **YES** |
| extension/src/metrics/claimTracker.ts | 1 | oob-human | — | — | **YES** |
| extension/src/metrics/failureModeInventory.ts | 1 | oob-unattributed | — | docs/reference/recurring-failure-mode-audit.md |  |
| extension/src/metrics/llmCostLedgerStore.ts | 1 | oob-cursor | — | — | **YES** |
| extension/src/metrics/swarmMetrics.ts | 1 | oob-cursor | BL-252-suite-duration-trend-holistic-briefing.feature<br>BL-264-wire-resource-sampler-activation.feature<br>BL-504-ts-metrics-ticket-id-extractor-allowlist-hyphen-optional.feature | — |  |
| extension/src/notify/costHealthSidecar.ts | 1 | oob-cursor | BL-264-wire-resource-sampler-activation.feature | docs/reference/backlog-dashboard-schema.md |  |
| extension/src/panel/backlogReader.ts | 1 | oob-unattributed | BL-455-pipeline-board-epic-grouping-parked-slug.feature | — |  |
| extension/src/swarm/swarmState.ts | 1 | oob-unattributed | BL-473-pipeline-board-shows-every-active-ticket.feature<br>BL-504-ts-metrics-ticket-id-extractor-allowlist-hyphen-optional.feature<br>BL-464-pipeline-board-authoritative-stage-source.feature<br>BL-452-pipeline-board-telegram-topic.feature | — |  |
| extension/src/swarm/swarmStopper.ts | 1 | oob-cursor | — | — | **YES** |
| extension/src/tools/failure-mode-inventory.ts | 1 | oob-unattributed | — | docs/reference/recurring-failure-mode-audit.md |  |
| extension/src/tools/notify-babysitter.ts | 1 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/ancillary_provider_lib.sh | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/babysitter.claude-settings.json | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/babysitter_assess.bb | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/babysitter_enqueue_wake.sh | 1 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/babysitter_nudge_lib.bb | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/babysitter_nudge_resident.bb | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/backlog_hygiene_lib.bb | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/check_swarm_detached.bb | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/closing_context_clear_lib.bb | 1 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/commit_integrity_cli.bb | 1 | oob-cursor | — | docs/briefings/2026-07-22.md<br>docs/briefings/2026-07-21.md |  |
| swarmforge/scripts/launch_front_desk_operator.sh | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/launch_operator.sh | 1 | oob-cursor | BL-511-telegram-bridge-cost-briefing.feature | — |  |
| swarmforge/scripts/llm_cost_ledger_lib.bb | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/openrouter_claude_env.sh | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/operator_lib.bb | 1 | oob-cursor | BL-466-agent-questions-as-telegram-polls.feature<br>BL-511-telegram-bridge-cost-briefing.feature<br>BL-383-the-front-desk-answers-at-the-agreed-verbosity.feature<br>BL-327-quiet-period-gate-cli.feature | — |  |
| swarmforge/scripts/operator_telegram.bb | 1 | oob-unattributed | BL-516-operator-telegram-console.feature | docs/how-to/BL-516-operator-telegram-console.md |  |
| swarmforge/scripts/read_proc_sigignore.sh | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/read_proc_sigignore_darwin.c | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/ready_for_next_batch.sh | 1 | oob-unattributed | BL-226-remove-dead-promote-in-ready-for-next.feature | — |  |
| swarmforge/scripts/ready_for_next_task.sh | 1 | oob-unattributed | BL-226-remove-dead-promote-in-ready-for-next.feature | — |  |
| swarmforge/scripts/reset_worktrees.sh | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/rotate_to_role.bb | 1 | oob-unattributed | BL-550-mono-router-stuck-after-merge-up-note.feature<br>BL-525-model-factory-role-model-assignment.feature | — |  |
| swarmforge/scripts/rotate_to_role.sh | 1 | oob-unattributed | BL-550-mono-router-stuck-after-merge-up-note.feature<br>BL-525-model-factory-role-model-assignment.feature | — |  |
| swarmforge/scripts/run_ancillary_front_desk.sh | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/specifier_backlog_hygiene_gate.bb | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/specifier_backlog_hygiene_gate.sh | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/stop_ancillary_services.sh | 1 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/swarm_identity_lib.bb | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/swarm_launch_pack_guard.bb | 1 | oob-cursor | — | — | **YES** |
| swarmforge/scripts/swarm_status_lib.bb | 1 | oob-unattributed | — | — | **YES** |
| swarmforge/scripts/ticket_close_guard_lib.bb | 1 | oob-cursor | — | — | **YES** |

## Out-of-band commits (newest first)

### 562e4e479 — ui(resident-spy): inline ticket id+title; tap fullscreen to restore split
- class: oob-session · author: Claude Code
- files: extension/src/bridge/residentSpyUiHtml.ts, extension/test/bridgeServer.test.js

### 85a8f2c76 — fix(handoff): scope chase gating per pane; stop wake-budget starvation
- class: oob-session · author: Claude Code
- files: swarmforge/scripts/handoffd.bb, swarmforge/scripts/mono_router_lib.bb, swarmforge/scripts/test/mono_router_lib_test_runner.bb

### ba248dd0e — fix(handoff): stop chase wake spam and count only delivered wakes
- class: oob-cursor · author: Claude Code
- files: swarmforge/scripts/chase_sweep_lib.bb, swarmforge/scripts/handoff_inject_lib.bb, swarmforge/scripts/handoffd.bb, swarmforge/scripts/test/actively_processing_test_runner.bb, swarmforge/scripts/test/chase_activity_nudge_test_runner.bb, swarmforge/scripts/test/chase_sweep_test_runner.bb, swarmforge/scripts/test/test_chase_sweep.sh, swarmforge/scripts/test/test_swarm_handoff_sync_deliver.sh

### b06ece63b — Fix burst Telegram approval repaint lag (BL-561).
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/bridgeServer.ts, extension/src/concierge/approvalAskClosing.ts, extension/src/concierge/conciergeTick.ts, extension/src/concierge/conciergeTickRequest.ts, extension/src/concierge/conciergeTickScheduler.ts, extension/src/concierge/decidedApprovalAskCloseReconcile.ts, extension/src/concierge/pendingApprovalReply.ts, extension/src/tools/telegram-front-desk-bot.ts, extension/src/tools/telegramFrontDeskBotCore.ts, extension/test/approvalAskClosing.test.js, extension/test/conciergeTick.test.js, extension/test/conciergeTickRequest.test.js, extension/test/conciergeTickScheduler.test.js, extension/test/decidedApprovalAskCloseReconcile.test.js, extension/test/pendingApprovalReply.test.js, extension/test/telegramFrontDeskBotCore.test.js

### dcfea4418 — Restore live-screen Telegram helpers lost to stale revert-resurrection.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/consoleMenuUiHtml.ts, extension/src/bridge/residentSpyUiHtml.ts, extension/src/concierge/residentPaneSpy.ts, extension/src/concierge/residentSpyTunnelNotify.ts, extension/src/notify/telegramClient.ts, extension/src/tools/notify-resident-spy-tunnel.ts, extension/src/tools/telegramFrontDeskBotCore.ts, extension/test/bridgeServer.test.js, extension/test/residentSpyTunnelNotify.test.js

### f7e7d5c9e — Fix stale extension tests after board pivot and BL-551 commit path.
- class: oob-cursor · author: Claude Code
- files: extension/test/approvalAskMore.test.js, extension/test/conciergeTick.test.js, extension/test/pipelineBoardPinSync.test.js, extension/test/residentSpyTunnelNotify.test.js, extension/test/telegramFrontDeskBotCli.test.js

### 7d491ec8a — Merge origin/main into swarmforge-hardender (handoff preamble + chase busy patterns).
- class: oob-cursor · author: Claude Code
- files: extension/src/tools/notify-resident-spy-tunnel.ts

### 3eb75297c — Merge origin/main into swarmforge-architect (handoff preamble + chase busy patterns).
- class: oob-cursor · author: Claude Code
- files: (none in scope)

### 457cbc625 — Skip handoff re-read preamble for Claude recipients (BL-519).
- class: oob-cursor · author: Claude Code
- files: swarmforge/scripts/handoff_lib.bb, swarmforge/scripts/swarm_handoff.bb, swarmforge/scripts/test/handoff_lib_test_runner.bb

### f500da405 — Fix close/pipeline desync after premature ticket close (BL-551).
- class: oob-cursor · author: Claude Code
- files: swarmforge/scripts/chase_sweep_lib.bb, swarmforge/scripts/commit_integrity_cli.bb, swarmforge/scripts/swarm_handoff.bb, swarmforge/scripts/test/test_ticket_close_guard.sh, swarmforge/scripts/test/ticket_close_guard_lib_test_runner.bb, swarmforge/scripts/ticket_close_guard_lib.bb

### 0a5a56b17 — Wire BL-528 claim-idle guards in handoffd so busy agents are not halted.
- class: oob-cursor · author: Claude Code
- files: swarmforge/scripts/handoffd.bb

### ef8bf3a52 — resolve merge conflict - use originLabel helper
- class: oob-unattributed · author: Claude Code
- files: (none in scope)

### 0e11053e7 — Sync Swarm Live Screen topic rename and shorten Claude in-process resume nudge.
- class: oob-cursor · author: Claude Code
- files: extension/src/tools/notify-resident-spy-tunnel.ts, extension/src/tools/telegram-front-desk-bot.ts, extension/test/telegramFrontDeskBotCli.test.js, swarmforge/scripts/agent_runtime_lib.bb, swarmforge/scripts/test/agent_runtime_test_runner.bb

### b5c1b97a1 — Add Approve action to the paused-ticket pager Mini App.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/bridgeServer.ts, extension/src/bridge/pausedPagerUiHtml.ts, extension/test/pausedPagerBridge.test.js

### bbb048fd6 — Rename mini app live feed to Swarm Live Screen.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/consoleMenuUiHtml.ts, extension/src/bridge/residentSpyUiHtml.ts, extension/src/concierge/residentPaneSpy.ts, extension/src/tools/telegramFrontDeskBotCore.ts, extension/test/bridgeServer.test.js

### f63a31aee — Restore browser native fullscreen for live screen pane expand.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/residentSpyUiHtml.ts, extension/test/bridgeServer.test.js

### beba65655 — Add collapsed epic pipeline board, live screen fixes, and BL-551 trend spec.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/bridgeServer.ts, extension/src/bridge/pausedPagerUiHtml.ts, extension/src/bridge/pipelineGridLive.ts, extension/src/bridge/pipelineGridUiHtml.ts, extension/src/bridge/residentSpyUiHtml.ts, extension/src/concierge/conciergeTick.ts, extension/src/concierge/pipelineBoard.ts, extension/src/metrics/llmCostLedger.ts, extension/src/tools/swarm-cost-rank.ts, extension/test/bridgeServer.test.js, extension/test/pausedPagerBridge.test.js, extension/test/pipelineBoard.test.js

### 118ecc79f — Fix handoff wake spam during explore turns and stabilize headless swarms.
- class: oob-cursor · author: Claude Code
- files: extension/src/swarm/swarmStopper.ts, extension/test/stop.test.js, swarmforge/scripts/chase_sweep_lib.bb, swarmforge/scripts/swarm_ensure.bb, swarmforge/scripts/swarmforge.sh, swarmforge/scripts/test/actively_processing_test_runner.bb

### 351185aa9 — Restore visible panes when live feed is offline.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/residentSpyUiHtml.ts, extension/test/bridgeServer.test.js

### c2a5607bd — Fix browser split-view scrolling on Cloudflare live screen.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/residentSpyUiHtml.ts, extension/test/bridgeServer.test.js

### 31f587c06 — Fix split-view pane scrolling after fullscreen layout changes.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/residentSpyUiHtml.ts

### 2a39425c2 — Fix Telegram live screen open path for group topics and private chat.
- class: oob-cursor · author: Claude Code
- files: extension/src/concierge/residentSpyTunnelNotify.ts, extension/src/notify/telegramClient.ts, extension/src/tools/notify-resident-spy-tunnel.ts, extension/test/residentSpyTunnelNotify.test.js

### e4d6dcc75 — Post Web App buttons in Mono Router Live Screen Telegram topic.
- class: oob-cursor · author: Claude Code
- files: extension/src/concierge/residentSpyTunnelNotify.ts, extension/src/notify/telegramClient.ts, extension/src/tools/notify-resident-spy-tunnel.ts, extension/test/residentSpyTunnelNotify.test.js

### fd38f80d8 — Add browser fullscreen fallback for live screen immersive expand.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/residentSpyUiHtml.ts, extension/test/bridgeServer.test.js

### d1bedfebd — Fix live screen expand with a dedicated fullscreen overlay layer.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/residentSpyUiHtml.ts, extension/test/bridgeServer.test.js

### 258c85874 — Add ticket strip and true fullscreen expand on live screen panes.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/residentSpyUiHtml.ts, extension/test/bridgeServer.test.js

### 0b49c2b45 — Remove live screen header bar so panes use full viewport on phone.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/residentSpyUiHtml.ts, extension/test/bridgeServer.test.js

### 9ea75f43c — Generalize live screen to all live swarm panes with expand toggle.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/residentPaneLive.ts, extension/src/bridge/residentSpyUiHtml.ts, extension/src/concierge/residentPaneSpy.ts, extension/test/bridgeServer.test.js, extension/test/residentPaneLive.test.js

### 160c810da — Add tap-to-expand fullscreen toggle on Mono Router Live Screen.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/residentSpyUiHtml.ts, extension/test/bridgeServer.test.js

### d63e80320 — Cap pipeline board parked list at 10 by priority and shorten link HTML.
- class: oob-cursor · author: Claude Code
- files: extension/src/concierge/conciergeTick.ts, extension/src/concierge/pipelineBoard.ts, extension/src/tools/telegram-front-desk-bot.ts, extension/test/pipelineBoard.test.js

### 1c211ea6b — Fix operator_runtime.bb parse error in relaunch config resolver
- class: oob-cursor · author: Claude Code
- files: swarmforge/scripts/operator_runtime.bb

### dc917a1e6 — Route ancillaries through active pack vendor and harden claim chase
- class: oob-cursor · author: Claude Code
- files: swarmforge/scripts/ancillary_provider_lib.sh, swarmforge/scripts/babysitter_assess.bb, swarmforge/scripts/babysitter_assess_lib.bb, swarmforge/scripts/babysitter_lib.bb, swarmforge/scripts/babysitter_nudge_lib.bb, swarmforge/scripts/babysitter_nudge_resident.bb, swarmforge/scripts/chase_sweep_lib.bb, swarmforge/scripts/claim_progress_lib.bb, swarmforge/scripts/launch_babysitter.sh, swarmforge/scripts/launch_front_desk_operator.sh, swarmforge/scripts/launch_operator.sh, swarmforge/scripts/openrouter_claude_env.sh, swarmforge/scripts/operator_runtime.bb, swarmforge/scripts/run_ancillary_front_desk.sh, swarmforge/scripts/start_ancillary_services.sh, swarmforge/scripts/swarm_attach.sh, swarmforge/scripts/swarm_identity_lib.bb, swarmforge/scripts/swarm_launch_pack_guard.bb, swarmforge/scripts/swarmforge.sh, swarmforge/scripts/test/babysitter_nudge_lib_test_runner.bb, swarmforge/scripts/test/chase_sweep_test_runner.bb, swarmforge/scripts/test/claim_progress_lib_test_runner.bb, swarmforge/scripts/test/prompt_engine_test_runner.bb, swarmforge/scripts/test/swarm_identity_lib_test_runner.bb, swarmforge/scripts/test/test_ancillary_provider_lib.sh, swarmforge/scripts/test/test_babysitter_nudge_resident.sh, swarmforge/scripts/test/test_claim_progress_sweep.sh, swarmforge/scripts/test/test_openrouter_claude_env.sh, swarmforge/scripts/test/test_swarm_launch_pack_guard.sh

### 3a5a43bda — BL-550: rotate mono-router resident home on empty non-home mailbox
- class: oob-cursor · author: Claude Code
- files: swarmforge/scripts/mono_router_lib.bb, swarmforge/scripts/ready_for_next.sh, swarmforge/scripts/ready_for_next_batch.bb, swarmforge/scripts/ready_for_next_task.bb, swarmforge/scripts/test/mono_router_lib_test_runner.bb, swarmforge/scripts/test/test_ready_for_next_rotate_home.sh

### aac692c10 — BL-551: wire LLM cost ledger writers and ranking surfaces.
- class: oob-cursor · author: Claude Code
- files: extension/src/bridge/bridgeServer.ts, extension/src/metrics/llmCostLedgerStore.ts, extension/src/notify/costHealthSidecar.ts, extension/src/tools/swarm-cost-rank.ts, extension/test/bridgeServer.test.js, extension/test/costHealthSidecar.test.js, extension/test/llmCostLedgerStore.test.js, extension/test/swarmCostRankCli.test.js, swarmforge/scripts/handoffd.bb, swarmforge/scripts/llm_cost_ledger_lib.bb, swarmforge/scripts/operator_lib.bb, swarmforge/scripts/operator_runtime.bb, swarmforge/scripts/test/llm_cost_ledger_lib_test_runner.bb, swarmforge/scripts/test/operator_lib_test_runner.bb

### 568857a0b — BL-551: add LLM cost ledger read-side (rank + rollups).
- class: oob-cursor · author: Claude Code
- files: extension/src/metrics/llmCostLedger.ts, extension/test/llmCostLedger.test.js

### 2586f630b — Wire babysitter to OpenRouter and BL-528 claim-progress preflight.
- class: oob-cursor · author: Claude Code
- files: swarmforge/scripts/babysitter.claude-settings.json, swarmforge/scripts/babysitter_assess_lib.bb, swarmforge/scripts/babysitter_lib.bb, swarmforge/scripts/babysitter_runtime.bb, swarmforge/scripts/handoffd.bb, swarmforge/scripts/launch_babysitter.sh, swarmforge/scripts/start_babysitter.sh, swarmforge/scripts/test/babysitter_assess_lib_test_runner.bb, swarmforge/scripts/test/babysitter_lib_test_runner.bb

### 36ae0a8e2 — Skip handoff delivery wakes when recipient pane is busy.
- class: oob-cursor · author: Claude Code
- files: swarmforge/scripts/handoffd.bb

### 2d3cb8893 — Relax BL-528 claim-without-progress thresholds for larger survey work.
- class: oob-cursor · author: Claude Code
- files: swarmforge/scripts/claim_progress_lib.bb, swarmforge/scripts/handoffd.bb, swarmforge/scripts/test/chase_sweep_test_runner.bb, swarmforge/scripts/test/claim_progress_lib_test_runner.bb, swarmforge/scripts/test/test_claim_progress_sweep.sh

### ffbacc573 — Fix headless swarm attach falsely reporting a dead tmux socket.
- class: oob-cursor · author: Claude Code
- files: swarmforge/scripts/swarm_attach.sh, swarmforge/scripts/swarmforge.sh

### 3517c393c — Fix Mono Router Live Screen ticket parsing for coordinator note prose.
- class: oob-cursor · author: Claude Code
- files: extension/src/concierge/residentPaneSpy.ts, extension/src/metrics/swarmMetrics.ts, extension/test/residentPaneSpy.test.js

### 1dad618ae — fix: restore BL-546 PromptEngine files dropped from BL-551 commit
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/agent_runtime_lib.bb, swarmforge/scripts/cache_warm_lib.bb, swarmforge/scripts/prompt_engine_cli.bb, swarmforge/scripts/prompt_engine_lib.bb, swarmforge/scripts/swarmforge.sh, swarmforge/scripts/test/agent_runtime_test_runner.bb, swarmforge/scripts/test/prompt_engine_test_runner.bb, swarmforge/scripts/test/test_prompt_engine_lib.sh

### 1990dc70d — Add BL-551 LLM invocation cost ledger (3h/24h/7d ranking)
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/agent_runtime_lib.bb, swarmforge/scripts/cache_warm_lib.bb, swarmforge/scripts/prompt_engine_cli.bb, swarmforge/scripts/prompt_engine_lib.bb, swarmforge/scripts/swarmforge.sh, swarmforge/scripts/test/agent_runtime_test_runner.bb, swarmforge/scripts/test/prompt_engine_test_runner.bb, swarmforge/scripts/test/test_prompt_engine_lib.sh

### 19a77b817 — Fix handoffd startup: wire missing BL-528 mono-router helpers.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/handoffd.bb, swarmforge/scripts/mono_router_lib.bb, swarmforge/scripts/test/mono_router_lib_test_runner.bb

### 51b6f00ff — Fix resident claim entered time not appearing on live screen
- class: oob-unattributed · author: Cursor Agent
- files: extension/src/bridge/residentPaneLive.ts, extension/src/bridge/residentSpyUiHtml.ts, extension/src/concierge/residentPaneSpy.ts, extension/src/swarm/swarmState.ts, extension/test/residentPaneLive.test.js, extension/test/residentPaneSpy.test.js

### 1217a3a20 — Polish Mono Router Live Screen pane headers (#20)
- class: oob-cursor · author: Laurent Decorps
- files: extension/src/bridge/residentPaneLive.ts, extension/src/bridge/residentSpyUiHtml.ts, extension/src/concierge/residentPaneSpy.ts, extension/test/residentPaneLive.test.js, extension/test/residentPaneSpy.test.js

### 9df3ba84c — Mono Router Live Screen: horizontal resident + coordinator split
- class: oob-unattributed · author: Cursor Agent
- files: extension/src/bridge/bridgeServer.ts, extension/src/bridge/consoleMenuUiHtml.ts, extension/src/bridge/residentPaneLive.ts, extension/src/bridge/residentSpyUiHtml.ts, extension/src/concierge/residentPaneSpy.ts, extension/src/tools/notify-resident-spy-tunnel.ts, extension/src/tools/telegramFrontDeskBotCore.ts, extension/test/bridgeServer.test.js, extension/test/residentPaneLive.test.js

### 6f9668ea0 — Show held ticket title in resident live screen header
- class: oob-unattributed · author: Cursor Agent
- files: extension/src/bridge/residentPaneLive.ts, extension/src/bridge/residentSpyUiHtml.ts, extension/src/concierge/residentPaneSpy.ts, extension/src/panel/backlogReader.ts, extension/test/residentPaneLive.test.js, extension/test/residentPaneSpy.test.js

### 22de365ca — feat: implement claim liveness evaluation
- class: oob-human · author: Laurent Decorps (aider)
- files: extension/src/metrics/claimLiveness.ts

### e6656b07a — test: add tests for claim liveness, tracker, and healer
- class: oob-human · author: Laurent Decorps (aider)
- files: extension/test/metrics/claimHealer.test.ts, extension/test/metrics/claimLiveness.test.ts, extension/test/metrics/claimTracker.test.ts

### af4a452c4 — feat: add claim healer to auto-heal idle claims
- class: oob-human · author: Laurent Decorps (aider)
- files: extension/src/metrics/claimHealer.ts

### 94ef96722 — feat: add claim tracker and include task in heartbeat payload
- class: oob-human · author: Laurent Decorps (aider)
- files: extension/src/metrics/claimTracker.ts, extension/src/tools/heartbeat.ts

### 7e2498634 — Make stop-swarm and start-swarm cover the full ops stack.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/start_ancillary_services.sh, swarmforge/scripts/stop_ancillary_services.sh, swarmforge/scripts/swarm_ensure.bb, swarmforge/scripts/swarm_status.bb

### 4c0daceff — Fix front desk restart storm during bot startup grace.
- class: oob-cursor · author: Laurent Decorps
- files: extension/src/tools/telegram-front-desk-bot.ts, swarmforge/scripts/front_desk_supervisor.bb, swarmforge/scripts/front_desk_supervisor_lib.bb, swarmforge/scripts/test/front_desk_supervisor_lib_test_runner.bb

### d0ef785e1 — Fix stale pipeline board pins by unpin-all before enforce.
- class: oob-cursor · author: Laurent Decorps
- files: extension/src/concierge/conciergeTick.ts, extension/src/concierge/pipelineBoardPinSync.ts, extension/test/conciergeTick.test.js, extension/test/pipelineBoardPinSync.test.js

### cf9f1a1ec — Wire pipeline board pin sync and harden handoff/router surfaces.
- class: oob-cursor · author: Laurent Decorps
- files: extension/src/bridge/residentPaneLive.ts, extension/src/concierge/conciergeTick.ts, extension/src/concierge/pipelineBoard.ts, extension/src/concierge/pipelineBoardPinSync.ts, extension/src/concierge/pipelineBoardSync.ts, extension/src/concierge/residentPaneSpy.ts, extension/src/swarm/backendSwitch.ts, extension/src/swarm/modelDisplayName.ts, extension/src/tools/telegram-front-desk-bot.ts, extension/test/backendSwitch.test.js, extension/test/conciergeTick.test.js, extension/test/modelDisplayName.test.js, extension/test/pipelineBoard.test.js, extension/test/pipelineBoardPinSync.test.js, extension/test/residentPaneLive.test.js, extension/test/residentPaneSpy.test.js, swarmforge/scripts/handoff_lib.bb, swarmforge/scripts/handoffd.bb, swarmforge/scripts/launch_babysitter.sh, swarmforge/scripts/provider_compat_lib.bb, swarmforge/scripts/swarmforge.sh, swarmforge/scripts/test/test_handoffd_role_context_clear_skip_rotation_router.sh

### 3e793c58a — Add Qwen Coding Plan mono-router start path.
- class: oob-cursor · author: Laurent Decorps
- files: swarmforge/scripts/failover_to_gpt.sh, swarmforge/scripts/handoff_lib.bb, swarmforge/scripts/provider_compat_lib.bb, swarmforge/scripts/swarm_ensure.bb, swarmforge/scripts/swarmforge.sh

### af6ddbf7a — Remove pipeline board auto-pin from the concierge tick.
- class: oob-cursor · author: Laurent Decorps
- files: extension/src/concierge/conciergeTick.ts, extension/src/concierge/pipelineBoardSync.ts, extension/src/tools/telegram-front-desk-bot.ts, extension/test/conciergeTick.test.js, extension/test/pipelineBoardSync.test.js

### 5c3a5aa4c — Sweep orphan pipeline board messages and quiet pin sync on unchanged ticks.
- class: oob-cursor · author: Laurent Decorps
- files: extension/src/concierge/conciergeTick.ts, extension/src/concierge/pipelineBoardSync.ts, extension/test/conciergeTick.test.js, extension/test/pipelineBoardSync.test.js

### d1b7d4a9f — Stop pipeline board pin spam on unchanged ticks and reposts
- class: oob-unattributed · author: Cursor Agent
- files: extension/src/concierge/conciergeTick.ts, extension/src/concierge/pipelineBoardPinSync.ts, extension/src/concierge/pipelineBoardSync.ts, extension/test/conciergeTick.test.js, extension/test/pipelineBoardPinSync.test.js, extension/test/pipelineBoardSync.test.js

### 5af42b8aa — Fix pipeline board links for root-intake tickets.
- class: oob-cursor · author: Laurent Decorps
- files: extension/src/concierge/conciergeTick.ts, extension/src/concierge/pipelineBoard.ts

### 7fd3e6501 — Fix Resident Spy header when SwarmForge banner scrolls off
- class: oob-unattributed · author: Cursor Agent
- files: extension/src/bridge/residentPaneLive.ts, extension/src/concierge/residentPaneSpy.ts, extension/src/swarm/backendSwitch.ts, extension/test/backendSwitch.test.js, extension/test/residentPaneLive.test.js, extension/test/residentPaneSpy.test.js

### 181d79153 — Post Resident Spy tunnel URL to Telegram when it changes.
- class: oob-cursor · author: Laurent Decorps
- files: extension/src/concierge/residentSpyTunnelNotify.ts, extension/src/tools/notify-resident-spy-tunnel.ts, extension/src/tools/telegram-front-desk-bot.ts, extension/src/tools/telegramFrontDeskBotCore.ts, extension/test/residentSpyTunnelNotify.test.js, swarmforge/scripts/launch_resident_spy_tunnel.sh

### 686866569 — Show model in Resident Spy header (role on model)
- class: oob-unattributed · author: Cursor Agent
- files: extension/src/bridge/residentPaneLive.ts, extension/src/bridge/residentSpyUiHtml.ts, extension/src/concierge/residentPaneSpy.ts, extension/src/swarm/modelDisplayName.ts, extension/test/modelDisplayName.test.js, extension/test/residentPaneLive.test.js, extension/test/residentPaneSpy.test.js

### 5945235a3 — Fix macOS swarm detach check and add GPT/Mistral launch scripts.
- class: oob-cursor · author: Laurent Decorps
- files: swarmforge/scripts/check_swarm_detached.bb, swarmforge/scripts/read_proc_sigignore.sh, swarmforge/scripts/read_proc_sigignore_darwin.c, swarmforge/scripts/swarmforge.sh

### 41bb0e459 — Use NBSP padding so pipeline board ticket ids align in Telegram.
- class: oob-unattributed · author: Cursor Agent
- files: extension/src/concierge/pipelineBoard.ts, extension/test/pipelineBoard.test.js

### 3a9d238de — Stop pipeline board pin spam when getChat omits the pinned message.
- class: oob-unattributed · author: Cursor Agent
- files: extension/src/concierge/conciergeTick.ts, extension/src/concierge/pipelineBoardPinSync.ts, extension/src/concierge/pipelineBoardSync.ts, extension/test/pipelineBoardPinSync.test.js

### 2caa43c27 — Align pivoted pipeline board ticket ids with the mark column.
- class: oob-unattributed · author: Cursor Agent
- files: extension/src/concierge/pipelineBoard.ts, extension/test/pipelineBoard.test.js

### 310b849a1 — Restore pivoted pipeline board grid for phone portrait.
- class: oob-cursor · author: Laurent Decorps
- files: extension/src/concierge/pipelineBoard.ts, extension/test/pipelineBoard.test.js

### 87546a748 — Fix Approvals asks, board links, Gemini runtime, and epic hygiene gates.
- class: oob-cursor · author: Laurent Decorps
- files: extension/src/concierge/approvalAskMore.ts, extension/src/concierge/approvalAskReconcile.ts, extension/src/concierge/conciergeTick.ts, extension/src/concierge/pipelineBoard.ts, extension/src/concierge/pipelineBoardSync.ts, extension/src/concierge/topicRouter.ts, extension/src/notify/telegramClient.ts, extension/src/tools/telegram-front-desk-bot.ts, extension/src/tools/telegramFrontDeskBotCore.ts, extension/test/approvalAskMore.test.js, extension/test/approvalAskReconcile.test.js, extension/test/conciergeTick.test.js, extension/test/conciergeTopicRouting.test.js, extension/test/pipelineBoard.test.js, extension/test/pipelineBoardSync.test.js, extension/test/telegramClient.test.js, extension/test/telegramFrontDeskBotCli.test.js, extension/test/telegramFrontDeskBotCore.test.js, swarmforge/scripts/agent_runtime_lib.bb, swarmforge/scripts/backlog_epic_milestone_audit.bb, swarmforge/scripts/backlog_hygiene_lib.bb, swarmforge/scripts/handoff_lib.bb, swarmforge/scripts/route_backlog_to_coder.sh, swarmforge/scripts/specifier_backlog_hygiene_gate.bb, swarmforge/scripts/specifier_backlog_hygiene_gate.sh, swarmforge/scripts/swarm_ensure.bb, swarmforge/scripts/swarmforge.sh, swarmforge/scripts/test/backlog_hygiene_lib_test_runner.bb, swarmforge/scripts/test/test_alternate_runtime_launch.sh

### 968c985e6 — Fix Approvals roster going dark after a Telegram topic remint.
- class: oob-cursor · author: Laurent Decorps
- files: extension/src/concierge/editInPlaceMessageSync.ts, extension/test/approvalsRosterSync.test.js, extension/test/conciergeTick.test.js, extension/test/recertPostingSync.test.js

### 751195038 — Harden mono-router handoff recovery and add start-swarm -clean.
- class: oob-cursor · author: Laurent Decorps
- files: swarmforge/scripts/chase_sweep_lib.bb, swarmforge/scripts/handoff_lib.bb, swarmforge/scripts/handoffd.bb, swarmforge/scripts/mono_router_lib.bb, swarmforge/scripts/reset_worktrees.sh, swarmforge/scripts/test/chase_activity_nudge_test_runner.bb, swarmforge/scripts/test/handoff_wake_session_test_runner.bb, swarmforge/scripts/test/mono_router_lib_test_runner.bb, swarmforge/scripts/test/test_chase_sweep.sh, swarmforge/scripts/test/test_reset_worktrees_align_main.sh

### 0b56a36f5 — style: normalize whitespace and alignment in handoff scripts
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/done_with_current_batch.bb, swarmforge/scripts/done_with_current_task.bb, swarmforge/scripts/ready_for_next_batch.bb, swarmforge/scripts/ready_for_next_task.bb

### cfb3a34c7 — fix: correct babashka function form and whitespace tweaks
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/dispatch_lib.bb, swarmforge/scripts/done_with_current_batch.bb, swarmforge/scripts/done_with_current_task.bb, swarmforge/scripts/ready_for_next_batch.bb

### c118d2cb0 — fix: restore defn for git-common-dir in dispatch_lib
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/dispatch_lib.bb

### 8c347ef37 — style: align batch/task helpers and dispatch formatting
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/dispatch_lib.bb, swarmforge/scripts/done_with_current_batch.bb, swarmforge/scripts/done_with_current_task.bb, swarmforge/scripts/ready_for_next_task.bb

### d8819df83 — style: normalize dispatch_lib receive-mode binding alignment
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/dispatch_lib.bb

### 9b2515521 — fix: wrap git-root definition in defn form
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/dispatch_lib.bb

### 6bfc88aa8 — fix: correct dispatch_lib git-root definition and align lets
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/dispatch_lib.bb, swarmforge/scripts/done_with_current_task.bb, swarmforge/scripts/ready_for_next_batch.bb, swarmforge/scripts/ready_for_next_task.bb

### 2f0ea88df — chore: align batch/task wrappers and indent fail messages
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/ready_for_next_batch.bb, swarmforge/scripts/ready_for_next_batch.sh, swarmforge/scripts/ready_for_next_task.bb, swarmforge/scripts/ready_for_next_task.sh

### 5566f2999 — style: align batch done script fail! indentation with task style
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/done_with_current_batch.bb

### e19733e0e — style: align fail! call arguments for batch and ambiguous states
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/done_with_current_task.bb

### 5ed5ee448 — style: align fail! argument indentation in done_with_current_task.bb
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/done_with_current_task.bb

### b964f9a8b — chore: adjust ready_for_next.sh script directory handling
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/ready_for_next.sh

### a587ae0ea — feat: add heartbeat helpers for stale detection and no-progress checks
- class: oob-unattributed · author: Claude Code
- files: extension/src/tools/heartbeat.ts

### 46c91d408 — Clean operator Telegram ensure state handling
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/operator_telegram.bb, swarmforge/scripts/test/test_operator_telegram.sh

### bfde39996 — BL-538 paused pager route and tests
- class: oob-unattributed · author: Claude Code
- files: extension/src/bridge/bridgeServer.ts, extension/test/bridgeServer.test.js, extension/test/paneTailerClass.test.js, extension/test/paneTailerPollResilience.test.js, extension/test/paneTailerScrollback.test.js, extension/test/pausedPagerBridge.test.js, extension/test/traceHopMain.test.js, swarmforge/scripts/gherkin_lint_gate.sh, swarmforge/scripts/gherkin_lint_gate_cli.bb, swarmforge/scripts/gherkin_lint_gate_legacy_wraps.txt, swarmforge/scripts/gherkin_lint_gate_lib.bb, swarmforge/scripts/test/gherkin_lint_gate_lib_test_runner.bb, swarmforge/scripts/test/test_gherkin_lint_gate.sh

### 01d7ada89 — Close BL-520 backlog bookkeeping
- class: oob-unattributed · author: Claude Code
- files: extension/test/bridgeServer.test.js, extension/test/paneTailerClass.test.js, extension/test/paneTailerPollResilience.test.js, extension/test/paneTailerScrollback.test.js, extension/test/traceHopMain.test.js

### 2ce41e2b1 — Drain BL-515 legacy wrap gate plumbing
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/gherkin_lint_gate.sh, swarmforge/scripts/gherkin_lint_gate_cli.bb, swarmforge/scripts/gherkin_lint_gate_legacy_wraps.txt, swarmforge/scripts/gherkin_lint_gate_lib.bb, swarmforge/scripts/test/gherkin_lint_gate_lib_test_runner.bb, swarmforge/scripts/test/test_gherkin_lint_gate.sh

### e2bd0115d — Clarify BL-101 remains human-verification only
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/gherkin_lint_gate.sh, swarmforge/scripts/gherkin_lint_gate_cli.bb, swarmforge/scripts/gherkin_lint_gate_legacy_wraps.txt, swarmforge/scripts/gherkin_lint_gate_lib.bb, swarmforge/scripts/test/gherkin_lint_gate_lib_test_runner.bb, swarmforge/scripts/test/test_gherkin_lint_gate.sh

### 1a620cbfb — Skip blocked paused tickets when promoting
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/promote_and_route_next.sh, swarmforge/scripts/test/test_promote_and_route_next_priority.sh

### 851f61c19 — fix(mono-router): rotate on dormant chase instead of false-waking coder
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/agent_runtime_lib.bb, swarmforge/scripts/failover_to_gpt.sh, swarmforge/scripts/handoff_lib.bb, swarmforge/scripts/handoffd.bb, swarmforge/scripts/mono_router_lib.bb, swarmforge/scripts/swarm_ensure.bb, swarmforge/scripts/test/mono_router_lib_test_runner.bb

### a64eab4b7 — fix(mono-router): open-slot nudge + promote_and_route_next
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/chase_sweep_lib.bb, swarmforge/scripts/handoffd.bb, swarmforge/scripts/promote_and_route_next.sh, swarmforge/scripts/test/dispatch_gap_test_runner.bb

### 01e2e7155 — fix(mono-router): after QA, coordinator must promote and route Work to coder
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/route_backlog_to_coder.sh

### acc1e0e14 — fix(BL-538): split paused-pager HTML and JSON routes; add bridge tests
- class: oob-unattributed · author: Claude Code
- files: extension/src/bridge/bridgeServer.ts, extension/src/bridge/pausedPagerUiHtml.ts, extension/test/pausedPagerBridge.test.js

### 286b49d33 — feat: implement paused pager ordering and expedite UI
- class: oob-unattributed · author: Claude Code
- files: extension/src/bridge/bridgeServer.ts, extension/src/bridge/pausedPagerUiHtml.ts

### 892a48c90 — feat: add paused-pager mini app with console button and routes
- class: oob-unattributed · author: Claude Code
- files: extension/src/bridge/bridgeServer.ts, extension/src/bridge/consoleMenuUiHtml.ts, extension/src/bridge/pausedPagerUiHtml.ts

### 0a91ace99 — feat(sre): babysitter wakes, status, mono-router ensure, dispatch-gap Spec trail
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/babysitter_enqueue_wake.sh, swarmforge/scripts/babysitter_lib.bb, swarmforge/scripts/babysitter_runtime.bb, swarmforge/scripts/backlog_epic_milestone_audit.bb, swarmforge/scripts/chase_sweep_lib.bb, swarmforge/scripts/handoffd.bb, swarmforge/scripts/launch_babysitter.sh, swarmforge/scripts/mono_router_lib.bb, swarmforge/scripts/start_babysitter.sh, swarmforge/scripts/swarm_ensure.bb, swarmforge/scripts/swarm_status.bb, swarmforge/scripts/swarm_status_lib.bb, swarmforge/scripts/swarmforge.sh, swarmforge/scripts/test/babysitter_lib_test_runner.bb, swarmforge/scripts/test/dispatch_gap_test_runner.bb, swarmforge/scripts/test/mono_router_lib_test_runner.bb, swarmforge/scripts/test/swarm_status_lib_test_runner.bb

### 57407e45b — feat(sre): add outside-chain Babysitter role with Telegram topic
- class: oob-unattributed · author: Claude Code
- files: extension/src/tools/notify-babysitter.ts, extension/src/tools/telegram-front-desk-bot.ts, extension/src/tools/telegramFrontDeskBotCore.ts, extension/test/telegramFrontDeskBotCore.test.js, swarmforge/scripts/launch_babysitter.sh, swarmforge/scripts/start_babysitter.sh

### 1b41c3415 — fix(sre): force Perplexity key remap when launch CLI targets its API
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/provider_compat_lib.bb, swarmforge/scripts/swarm_ensure.bb, swarmforge/scripts/swarmforge.sh, swarmforge/scripts/test/provider_compat_lib_test_runner.bb

### aff9c5fae — BL-512: recurring failure-mode inventory and audit slate
- class: oob-unattributed · author: Claude Code
- files: extension/src/metrics/failureModeInventory.ts, extension/src/tools/failure-mode-inventory.ts, extension/test/failureModeInventory.test.js

### e7149af9a — feat: Telegram + email alerts on endless-loop swarm halt
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/handoffd.bb, swarmforge/scripts/loop_detect_lib.bb, swarmforge/scripts/test/loop_detect_lib_test_runner.bb

### 65cdc143b — feat: hard-stop swarm on endless NO_TASK pane spins
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/handoffd.bb, swarmforge/scripts/loop_detect_lib.bb, swarmforge/scripts/test/loop_detect_lib_test_runner.bb

### 16653fac1 — docs: Perplexity mono-router pack, aider coordinator model, idle rules
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/handoff_lib.bb, swarmforge/scripts/swarm_ensure.bb, swarmforge/scripts/swarmforge.sh

### 72033d9d4 — Stop stuck-role email floods on mono-router dormant panes.
- class: oob-cursor · author: Laurent Decorps
- files: swarmforge/scripts/chase_sweep_lib.bb, swarmforge/scripts/handoffd.bb

### 33e7fbbee — Ship BL-526 console menu/grid and fix mono-router handoff wakes.
- class: oob-cursor · author: Laurent Decorps
- files: extension/src/bridge/bridgeAuth.ts, extension/src/bridge/bridgeServer.ts, extension/src/bridge/consoleMenuUiHtml.ts, extension/src/bridge/pipelineGridLive.ts, extension/src/bridge/pipelineGridUiHtml.ts, extension/src/concierge/pipelineBoard.ts, extension/test/bridgeServer.test.js, extension/test/pipelineBoard.test.js, swarmforge/scripts/handoff_inject_lib.bb, swarmforge/scripts/handoff_lib.bb, swarmforge/scripts/handoffd.bb, swarmforge/scripts/swarmforge.sh, swarmforge/scripts/test/test_shipped_confs_no_coordinator_window.sh

### 11486a3ef — Wire BL-522 Resident Spy bridge routes (/resident-spy, /resident-pane)
- class: oob-unattributed · author: Claude Code
- files: extension/src/bridge/bridgeAuth.ts, extension/src/bridge/bridgeServer.ts, extension/src/bridge/residentPaneLive.ts, extension/src/bridge/residentSpyUiHtml.ts, extension/src/concierge/residentPaneSpy.ts, extension/test/bridgeServer.test.js, swarmforge/scripts/launch_resident_spy_tunnel.sh

### 94ecbfd6e — Serve bridge HTML token gate without prior auth so remote UI is reachable.
- class: oob-unattributed · author: Claude Code
- files: extension/src/bridge/bridgeServer.ts, extension/src/bridge/holisticUiHtml.ts, extension/test/bridgeServer.test.js

### 0c1f799ab — Fix swarm ensure/failover for GPT mono-router and document the cold path.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/failover_to_gpt.sh, swarmforge/scripts/handoff_lib.bb, swarmforge/scripts/swarm_ensure.bb, swarmforge/scripts/swarmforge.sh, swarmforge/scripts/test/test_swarm_ensure.sh

### 054482b39 — Fix Codex mono-router launch: stop catting prompt into argv.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/swarmforge.sh

### dd60d80a1 — Add manual Cerebras→GPT failover helper until BL-525 automates daily-cap switch.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/failover_to_gpt.sh

### e57ff5b24 — Fix Cerebras pack auth: do not let host OPENAI_API_KEY shadow the mapped key.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/swarmforge.sh

### 6b1b8cfad — Add Cerebras mono-router pack and file BL-525 daily-cap failover intake.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/handoff_lib.bb, swarmforge/scripts/swarmforge.sh

### ffc024c4a — Close BL-523: OpenRouter provider for claude-harness roles.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/test/test_openrouter_provider_support.sh

### d1e40e6f2 — Restore BL-421/423 while keeping mono-router live-feed attach.
- class: oob-unattributed · author: Claude Code
- files: extension/src/panel/paneTailer.ts, extension/src/swarm/swarmLauncher.ts, extension/src/swarm/tmuxClient.ts, extension/test/swarmLauncher.test.js

### f89681ad5 — Attach panel live feed under mono-router dormant roles.
- class: oob-unattributed · author: Claude Code
- files: extension/src/panel/paneTailer.ts, extension/src/swarm/swarmLauncher.ts, extension/src/swarm/tmuxClient.ts, extension/test/swarmLauncher.test.js

### d3d2c9eb7 — Fix mono-router rotate to target resident pane and keep OpenRouter env.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/handoff_lib.bb

### bd1b89c35 — Pass OpenRouter auth through launch and chase/ensure respawn.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/handoffd.bb, swarmforge/scripts/swarm_ensure.bb, swarmforge/scripts/swarmforge.sh

### 9abe83732 — Fix post-/clear resume for BL-519 inlined system prefix.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/closing_context_clear_lib.bb, swarmforge/scripts/test/closing_context_clear_test_runner.bb

### c7824e613 — Nudge coordinator when active tickets lack assigned_to.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/chase_sweep_lib.bb, swarmforge/scripts/handoffd.bb, swarmforge/scripts/test/dispatch_gap_test_runner.bb

### 96ffe3e49 — Add mono-router pack: one resident agent, model tailored per stage
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/handoff_lib.bb, swarmforge/scripts/rotate_to_role.bb, swarmforge/scripts/rotate_to_role.sh, swarmforge/scripts/swarmforge.sh

### fc0394491 — Harden BL-490: split two CRAP-violating callback dispatchers, cover multi-candidate collision search
- class: oob-unattributed · author: Claude Code
- files: extension/src/tools/telegramFrontDeskBotCore.ts, extension/test/expediteSafety.test.js

### a6aa55bd1 — Merge main into QA-approved BL-497 for integration
- class: oob-unattributed · author: Claude Code
- files: (none in scope)

### 0a76dfb46 — Make start-swarm and ensure bring up the full stack.
- class: oob-unattributed · author: Claude Code
- files: swarmforge/scripts/swarm_ensure.bb, swarmforge/scripts/swarmforge.sh, swarmforge/scripts/test/test_swarm_ensure.sh

### f74a8c8da — BL-457: reserve known epics' pinned glyphs before pool assignment
- class: oob-unattributed · author: Claude Code
- files: extension/src/concierge/conciergeTick.ts, extension/src/concierge/epicIcon.ts, extension/test/conciergeTick.test.js

### 412f4de44 — BL-403: Implement graceful pid termination before supervisor restart
- class: oob-session · author: Claude Code
- files: swarmforge/scripts/front_desk_supervisor.bb, swarmforge/scripts/front_desk_supervisor_lib.bb, swarmforge/scripts/test/bl403_supervisor_kill_acceptance_runner.bb, swarmforge/scripts/test/front_desk_supervisor_lib_test_runner.bb

