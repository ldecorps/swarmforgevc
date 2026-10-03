# Census: closed tickets' acceptance features with no step handler, 2026-10-03

Taken by the specifier on QA's unowned-red note 003788 (BL-1861 held on
`specs/features/BL-096-velocity-burndown-metrics.feature`, 8/8 "no step
handler matched").

## Method (re-runnable)

Load the live registry exactly as the runner does, then try every
non-placeholder step line of every feature against it, scoped by the
feature's own `Feature:` name:

```js
const {createStepRegistry}=require(root+'/specs/pipeline/stepRegistry');
const reg=createStepRegistry();
require(root+'/specs/pipeline/steps/index.js').registerSteps(reg);
// for each specs/features/*.feature: steps = lines matching
//   /^\s*(Given|When|Then|And|But)\s+(.*)$/  without a <placeholder>
// a feature is WHOLLY UNBOUND when reg.resolve(step, featureName) is null
// for every one of them
```

Then join each file's ticket id to `backlog/{active,paused}/<id>-*.yaml`
(open), `backlog/done/**/<id>-*.yaml` (done), else anywhere under
`backlog/`.

Spot-checked with the real runner: BL-096 (QA: `# pass 0 # fail 8`) and
BL-1453 (every scenario "no step handler matched").

## Result at main b28cf09e09

149 wholly-unbound features. 94 belong to OPEN tickets (87 paused, 7
active): their handlers land in their own parcels, so they are unbuilt by
design, not reds. **55 belong to closed tickets**: 44 in `backlog/done/`,
11 in `backlog/debt/`. Each of those 55 fails every scenario if run, and
no register row names any of them. They are the class.

Partially-bound features (some steps resolve, some do not) are NOT
counted here.

## The 55 (file, step lines, where the ticket is)

| feature | steps | ticket |
|---|---|---|
| `BL-091-remote-swarm-bringup-wsl2.feature` | 15 | done |
| `BL-096-velocity-burndown-metrics.feature` | 31 | done |
| `BL-097-backlog-dashboard-pwa-pages.feature` | 25 | done |
| `BL-100-token-cost-resource-telemetry.feature` | 17 | done |
| `BL-1034-an-expedited-run-commits-the-backlog-moves-it-makes.feature` | 32 | debt |
| `BL-1042-host-load-throttles-intake-automatically.feature` | 20 | debt |
| `BL-1044-the-terminal-title-names-the-ticket-a-role-holds.feature` | 45 | debt |
| `BL-1047-promotion-routes-by-design-state-not-by-a-mint-default.feature` | 15 | debt |
| `BL-1051-a-lets-talk-reply-answers-in-the-language-it-was-asked-in.feature` | 6 | debt |
| `BL-1055-a-hydrate-run-ends-when-the-specifier-hands-work-to-the-coder.feature` | 9 | debt |
| `BL-1059-closed-tickets-say-they-are-still-open.feature` | 15 | debt |
| `BL-106-swarm-name-branch-namespace.feature` | 13 | done |
| `BL-1067-tmux-reaper-guard-certifies-track-without-the-socket-pointer.feature` | 18 | debt |
| `BL-1068-production-kill-decisions-read-a-truncated-pgrep-listing.feature` | 13 | debt |
| `BL-1072-detached-run-dies-with-no-ending-marker.feature` | 18 | debt |
| `BL-1073-rolling-mailbox-retention.feature` | 30 | debt |
| `BL-111-aps-stage1-feature-files.feature` | 14 | done |
| `BL-112-aps-stage2-executable-acceptance.feature` | 10 | done |
| `BL-114-issue-intake-loop-closing.feature` | 10 | done |
| `BL-116-launch-path-probe-and-log.feature` | 10 | done |
| `BL-117-pwa-docs-drilldown-explorer.feature` | 18 | done |
| `BL-118-pwa-bilingual-french.feature` | 24 | done |
| `BL-128-coordinator-specifier-separate-mailboxes.feature` | 14 | done |
| `BL-131-eliminate-real-timers-in-test-suite.feature` | 8 | done |
| `BL-132-surface-mutation-progress-eta.feature` | 10 | done |
| `BL-142-agent-brand-abstraction-layer.feature` | 12 | done |
| `BL-143-coordinator-inbox-view-hides-sidecars-by-default.feature` | 12 | done |
| `BL-150-gherkin-recertification-phone.feature` | 22 | done |
| `BL-151-handoff-transport-reliability-epic.feature` | 6 | done |
| `BL-206-fork-provider-capability-lifecycle-contract.feature` | 8 | done |
| `BL-210-paneTailer-emitActivityEvents-crap.feature` | 10 | done |
| `BL-211-velocity-burndown-charts-bl094-ui.feature` | 9 | done |
| `BL-212-deflake-spawn-registry-01.feature` | 10 | done |
| `BL-213-cost-health-briefing-phone.feature` | 16 | done |
| `BL-242-baton-fleet-composite-epic.feature` | 6 | done |
| `BL-311-intake-doc-archive-hygiene.feature` | 9 | done |
| `BL-428-decrap-paneHistory-slice.feature` | 18 | done |
| `BL-523-openrouter-provider-support.feature` | 20 | done |
| `BL-544-specifier-epic-milestone-hygiene.feature` | 15 | done |
| `BL-559-pipeline-board-collapsed-epics.feature` | 9 | done |
| `BL-562-backlog-depth-warning-counts-gitkeep.feature` | 12 | done |
| `BL-573-stage-sync-scans-inbox-new.feature` | 19 | done |
| `BL-639-parcel-age-counts-deliberate-downtime.feature` | 19 | done |
| `BL-657-launcher-tmux-server-dies-seconds-after-launch.feature` | 17 | done |
| `BL-661-stage-skip-reasons-flow-style-unreadable-by-lib.feature` | 15 | done |
| `BL-662-paused-pager-swallows-server-failure-reason.feature` | 11 | done |
| `BL-699-pilot-quality-bounce-backs.feature` | 19 | done |
| `BL-700-pilot-telegram-status-posts.feature` | 16 | done |
| `BL-701-pilot-orphan-cleanup-stage-boundaries.feature` | 8 | done |
| `BL-702-operator-parse-env-reload-danger-tiers.feature` | 39 | done |
| `BL-704-operator-shifts-holidays-docs.feature` | 21 | done |
| `BL-705-lets-talk-more-chiptunes.feature` | 12 | done |
| `BL-706-lets-talk-floating-minimized-chat.feature` | 15 | done |
| `BL-707-android-floating-overlay-companion.feature` | 25 | done |
| `BL-716-bubble-lets-talk-tunnel-hostname-dns.feature` | 22 | done |

## Disposition

- BL-096's feature (the one a parcel tripped on): its behaviour is live
  (`/metrics` route, bridgeServer.ts; `swarm-metrics` CLI;
  `computeDeliveryMetrics`), so it is WIRED, not retired: BL-1937, register
  row owned by BL-1937.
- The other 54: recorded on BL-541 (epic code-quality-gates) as a
  remaining slice with this census; the register posture for them is put
  to the human (specifier role_ask, 2026-10-03), because registering all
  54 rows trips Article 3.5's "register over 10" throttle.

By specifier.
