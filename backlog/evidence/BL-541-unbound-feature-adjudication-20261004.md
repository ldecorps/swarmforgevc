# BL-541 register drain: adjudication of the 54 unbound closed-ticket features, 2026-10-04

The human ruled A on 2026-10-03 ("A - register all 54 now (throttles intake)"): all 54 were registered (7ac0a7826f). The specifier then decided each one. Evidence was gathered by five read-only passes over the code, git history and tickets; every retirement was checked by the specifier against the supersede marker, the closing commit or the code before it was made. Census: backlog/evidence/BL-1937-closed-tickets-features-with-no-step-handler-census-20261003.md.

Outcomes: 11 parked tickets' features became .feature.draft (cbf3e77ad9); 14 features retired whole; 14 features lost the scenarios listed below and keep the rest; 29 features are to be wired by coder slices. A retirement removes a feature or scenario and never rewords one. Retired whole features are in the retirement registry (BL-1258).

## Parked (backlog/debt/, never built) -> .feature.draft, 11

- `BL-1034-an-expedited-run-commits-the-backlog-moves-it-makes.feature`
- `BL-1042-host-load-throttles-intake-automatically.feature`
- `BL-1044-the-terminal-title-names-the-ticket-a-role-holds.feature`
- `BL-1047-promotion-routes-by-design-state-not-by-a-mint-default.feature`
- `BL-1051-a-lets-talk-reply-answers-in-the-language-it-was-asked-in.feature`
- `BL-1055-a-hydrate-run-ends-when-the-specifier-hands-work-to-the-coder.feature`
- `BL-1059-closed-tickets-say-they-are-still-open.feature`
- `BL-1067-tmux-reaper-guard-certifies-track-without-the-socket-pointer.feature`
- `BL-1068-production-kill-decisions-read-a-truncated-pgrep-listing.feature`
- `BL-1072-detached-run-dies-with-no-ending-marker.feature`
- `BL-1073-rolling-mailbox-retention.feature`

## Retired whole, 14

- `BL-091-remote-swarm-bringup-wsl2.feature`: unwireable: a live ./swarm under WSL2, a second machine and a human following the how-to; its filter (belongs-to-own-swarm?, BL-090) is unit-tested.
- `BL-131-eliminate-real-timers-in-test-suite.feature`: whole-suite meta claims (a refactor changed nothing, a runtime baseline of 88 tests); the narrower BL-362 is wired; scenario 01's rule is broken today and is owned on BL-791.
- `BL-150-gherkin-recertification-phone.feature`: superseded: BL-451 retired the PWA recert view; BL-450 restates every scenario for Telegram and is wired.
- `BL-151-handoff-transport-reliability-epic.feature`: an epic umbrella that carries no code; its children are closed.
- `BL-242-baton-fleet-composite-epic.feature`: an epic umbrella that carries no code; its children carry their own wired features.
- `BL-311-intake-doc-archive-hygiene.feature`: unwireable: an agent's manual move inside gitignored .swarmforge/ plus a prompt-says-so claim; the ticket itself names no code path.
- `BL-428-decrap-paneHistory-slice.feature`: a stray copy: 0e203a6627 parked it as .feature.draft (header: do not materialize), e52261521e restored the .feature by mistake.
- `BL-562-backlog-depth-warning-counts-gitkeep.feature`: superseded by BL-808 (supersedes: BL-562), whose feature is wired.
- `BL-573-stage-sync-scans-inbox-new.feature`: superseded by BL-670 (supersedes: BL-573); shipped as BL-1048, both features wired.
- `BL-639-parcel-age-counts-deliberate-downtime.feature`: superseded by BL-650 and BL-823 (closed so, 704d6d9b14); its audit-log mechanism was never built.
- `BL-657-launcher-tmux-server-dies-seconds-after-launch.feature`: unwireable: a live tmux server alive 60 s after launch and a real restart; the pure scrub is gated by test_harness_env_scrub_bl657.sh and test_bl657_wait_for_ready_sustained_check.sh.
- `BL-706-lets-talk-floating-minimized-chat.feature`: unwireable: the Let's Talk page's audio and on-screen layout (a webview surface); its markup is pinned by letsTalkBridge.test.js and letsTalkCore.test.js.
- `BL-707-android-floating-overlay-companion.feature`: unwireable: the Android overlay on a device (BL-769: a recorded manual procedure, never a feature); pure logic is in the JVM suite.
- `BL-716-bubble-lets-talk-tunnel-hostname-dns.feature`: unwireable: phone behaviour (BL-769); the host-side pairing link is unit- and property-tested in residentSpyTunnelNotify.

## Scenarios retired from features that stay, 14 features

- `BL-097-backlog-dashboard-pwa-pages.feature`, 1 scenario(s) 'background sync keeps the cache recent on Android': unwireable: an installed PWA on Android Chrome; the periodicsync handler is unit-tested.
- `BL-106-swarm-name-branch-namespace.feature`, 1 scenario(s) 'mismatched branch fails fast': superseded: check_branch_namespace.bb is not wired into launch (its own header), and BL-1515's turn guard enforces the swarmforge-<role> names the live worktrees carry.
- `BL-111-aps-stage1-feature-files.feature`, 1 scenario(s) 'APS tools are installed at the pinned ref': unwireable: install_aps_tools.sh clones from GitHub.
- `BL-117-pwa-docs-drilldown-explorer.feature`, 1 scenario(s) 'the documentation is live against main': unwireable: a GitHub Actions publish and a real app fetch.
- `BL-128-coordinator-specifier-separate-mailboxes.feature`, 1 scenario(s) 'existing specifier and coordinator duties are unaffected': a meta claim about role duties.
- `BL-132-surface-mutation-progress-eta.feature`, 1 scenario(s) 'the tile shows mutation progress when the webview is healthy': never built (nothing outside mutation/ reads the progress file) and a webview surface.
- `BL-212-deflake-spawn-registry-01.feature`, 1 scenario(s) 'the registry-recording test uses a spawn double, not a real detached process': a claim about a unit test's own setup.
- `BL-212-deflake-spawn-registry-01.feature`, 1 scenario(s) 'the test passes deterministically under parallel load': a flakiness claim, not gateable.
- `BL-699-pilot-quality-bounce-backs.feature`, 1 scenario(s) 'the /pilot prompt requires a Telegram poll for human questions': superseded by BL-725: it asserts the retired topic name Cursor Remote.
- `BL-700-pilot-telegram-status-posts.feature`, 3 scenario(s) 'the /pilot prompt requires Telegram status posts on': superseded by BL-725: each asserts a Cursor Remote Telegram post, a retired topic name.
- `BL-701-pilot-orphan-cleanup-stage-boundaries.feature`, 1 scenario(s) 'the /pilot prompt protects host bridge and Oper': superseded by BL-725: it asserts the retired name Cursor Remote.
- `BL-702-operator-parse-env-reload-danger-tiers.feature`, 1 scenario(s) 'Hard-tier /stop runs kill_all_swarm after confirm': superseded: /stop now offers drain or emergency (executeStopMode); the generic confirm is ignored.
- `BL-704-operator-shifts-holidays-docs.feature`, 1 scenario(s) '/oncall me routes alerts to the principal': half never built: only /ensure reads oncallId (telegramCursorOperatorExec.ts:255), no ambulance path does; the ensure half is unit-tested.
- `BL-704-operator-shifts-holidays-docs.feature`, 1 scenario(s) 'How-to and Cursor Remote diagrams exist': a docs-exist meta claim.
- `BL-705-lets-talk-more-chiptunes.feature`, 1 scenario(s) 'new songs still show a title while playing': unwireable: set only inside the live webview's Web Audio start path.
- `BL-705-lets-talk-more-chiptunes.feature`, 1 scenario(s) 'YM decoder is out of scope for this ticket': a scope statement, not behaviour.

## To wire, 29 (binding hints for the slices)

- BL-097: generator + schema + PWA client in-process (computeBacklogDashboard on a fixture repo, BACKLOG_DASHBOARD_SCHEMA_VERSION, jsdom index.html/app.js, sw.js in a vm); M.
- BL-100: transcriptUsage, costTelemetry, pricingTable, resourceTelemetry over fixture JSONL; S.
- BL-106: prepare_worktrees names ${SWARM_NAME}/<role>; migrate_branch_names.sh; fixture git repo; M.
- BL-111: gherkin_lint_gate.sh on the vendored parser (S); migrate_gherkin_to_features.bb on a fixture backlog (M).
- BL-112: specs/pipeline runnerAdapter/generate/runtime test themselves; S.
- BL-114: issue_specced.sh / issue_done.sh with a fake gh on PATH; S (wording: comment posts the path).
- BL-116: swarmLauncher probeLoginShellPath/augmentPath/launchSwarm with fakes; S.
- BL-117: computeDocsTree (S); jsdom docs explorer (M).
- BL-118: i18n translate session with a fake MT engine + jsdom locale harness; M.
- BL-128: per-role mailbox resolver, ready_for_next, handoffd --poll-once, migrate_shared_mailbox.bb in a fixture; bl1219RoleInboxResolutionSteps.js is the pattern; M.
- BL-132: MutationProgressReporter with injected now/write; S.
- BL-142: agentPaneState provider registry + detection functions; S.
- BL-143: inboxVisibility.computeRoleQueueView + queue-status CLI --debug (today's wording, BL-323); S.
- BL-206: agent_runtime_lib.bb steps via a specs/pipeline/steps/lib/*Cli.bb shim (capability map in prompt_engine_lib.bb since BL-546); S-M.
- BL-210: paneTailer decideRoleActivity (S); the class with fakeTmux + fakeScheduler (M).
- BL-211: holisticUiHtml in jsdom with a fake /metrics (bl603 pattern); M.
- BL-212: launchSwarm with an injected spawnFn, readTrackedJobs; M.
- BL-213: costHealthSidecar build/render/commit on a fixture repo, backlogDashboard fold-in, pwa renderCostHealth in jsdom; M.
- BL-523: swarmforge.sh write_role_launch_script in a mkdtemp via zsh; scenario 02's ANTHROPIC_API_KEY unset for an OpenRouter role looks unimplemented - bind as written, report a red; M.
- BL-544: specifier_backlog_hygiene_gate.bb with BACKLOG_HYGIENE_ROOT seams (bl1105 pattern); S.
- BL-559 (collapsed-epics): pipelineBoard computePipelineBoard/buildCollapsedEpicEntries; S.
- BL-661: required_stages_lib read-stage-skip-reasons (S) and swarm_handoff route-required-stages on the bl754 fixture (M).
- BL-662: pausedPagerUiHtml in jsdom with stubbed fetch/confirm (bl609 pattern); M.
- BL-699: composePilotExpeditorPrompt (pure) + the expedite-lock gate on a mkdtemp lock; S.
- BL-700: formatPilot*Status helpers (scenario 04); S.
- BL-701: the STAGE-BOUNDARY CLEANUP block of the pilot prompt (scenario 01); S.
- BL-702: telegramCursorBridgeCore/OperatorCore deciders (S) and executeOperatorVerb on a mkdtemp repo with stub scripts (M); 'Cursor Remote' in a Given/When names the topic now displayed as Host.
- BL-704: holiday refusal via handleInboundDecision (M) and the shift/holiday round-trip via executeOperatorVerb (S).
- BL-705: getLetsTalkChiptunesCatalog (chip-01); S.

## Gaps recorded, not hidden

- BL-704's /oncall scenario promised that ambulance alerts follow the oncall id. Only /ensure reads it (telegramCursorOperatorExec.ts:255). The scenario was retired as never built and unasked since 2026-07; if ambulance routing is wanted, it is a new ticket.
- BL-131's rule (no real timers in unit tests) is broken in 54 places across 30 files today. Owned as BL-791 slice H.
- BL-523 scenario 02 (ANTHROPIC_API_KEY unset for an OpenRouter seat) looks unimplemented; its slice binds it as written and reports a red.

By specifier.
