# BL-335 investigation evidence — 20260713 (coder)

Per the ticket's own mandate: verification first, against the human's REAL
surfaces, never a passing test. Every claim below cites a real artifact
(git log, real logs, a real command run, or a live network fetch) — none is
sourced from a unit test.

## REPORT 1 — "The diagrams in the daily email are still not rendered" (filed 2026-07-12T03:24Z)

VERDICT: STALE

CAUSE RULED IN: the running build being stale — RULED IN.
CAUSE RULED OUT: the emitter only running on a host — RULED OUT (the diagram
render/send path runs inside `handoffd.bb`'s own headless poll loop, not the
VS Code extension host).
CAUSE RULED OUT: the emitter never reaching the surface — RULED OUT (the
attachment IS wired into the real Resend POST body — see wiring evidence).

EVIDENCE:
- Wiring (real code, not a test): `swarmforge/scripts/handoffd.bb:1144` calls
  `(briefing-email-sweep!)` inside the `-main` poll loop (every 5 cycles);
  `briefing-email-sweep!` (handoffd.bb:828-838) wires
  `briefing-email-lib/build-diagram-section` (`briefing_email_lib.bb:114-131`,
  which emits a `cid:` image src + a matching `{:filename :content-id
  :base64}` attachment descriptor) into `send-configured-briefing-email!`,
  which forwards `:attachments` through to `daemon-alarm-lib/send-configured-
  email!` -> `send-alarm-email!`'s 8-arg form -> `default-post!`
  (`daemon_alarm_lib.bb:70-84`), which includes `:attachments` in the actual
  Resend HTTP POST body. This chain is production code, not test-only.
- Real command run: `node extension/out/tools/render-briefing-diagrams.js`
  (main checkout) — exit 0, produced a valid ~195KB base64 PNG for
  "architecture". The renderer is functionally correct right now.
- Real log evidence (main checkout `.swarmforge/daemon/handoffd.log` +
  `daemon-start-audit.log`): 33,140 `briefing-skip-missing-key` events
  recorded before `2026-07-11T11:13:42Z` — RESEND_API_KEY was absent from
  the daemon's environment for the daemon's entire prior history. The
  FIRST-EVER successful `briefing-sent` in any log is
  `2026-07-11T11:13:43.887Z`.
- BL-286 (the cid-attachment fix) merged `2026-07-11 13:41:28 +0100`
  (`6581a162`/`fd173495`) — AFTER that 11:13:43 daemon restart, so the
  running handoffd process at that moment was still pre-BL-286 (data-URI
  images, which Gmail blocks).
- The next daemon restart was not until `2026-07-12T10:05:35Z` (real
  `daemon-start-audit.log` entry) — a ~20h24m window in which the LIVE
  process ran pre-BL-286 code. `2026-07-12.md` was sent inside that window,
  at `2026-07-12T02:32:24Z`, with (per the code active at that time)
  data-URI diagrams.
- The human's report at `2026-07-12T03:24Z`, ~52 minutes after that send,
  is exactly explained by this: he was looking at an email a pre-BL-286
  build produced.

ANSWER: report 1 was accurate at the time (his diagrams genuinely did not
render), caused by a stale-running-build window that predated BL-286's fix
reaching the live daemon process, not by broken or unwired code. Re-verified
live just now (render command + wiring trace): the diagram/cid path is
correct and reachable in production today.

## REPORT 2 — "suite-duration trend...still not showing on pwa and email" (filed 2026-07-12T02:14Z)

VERDICT: STALE (email side + PWA side both confirmed present now)

CAUSE RULED IN (historically, email side only): the running build being
stale — RULED IN (same RESEND_API_KEY-outage window as report 1: the first
successful briefing email of any kind was 2026-07-11T11:13:43Z; BL-252
merged 2026-07-10 17:58, so it was correct code sitting behind the same
send-side outage, not a bug in BL-252 itself).
CAUSE RULED OUT: the emitter only running on a host — RULED OUT for the
email side (handoffd's own headless loop, see wiring below). For the PWA
side the "host" in question is GitHub Actions, not the VS Code extension
host — headless-by-design and confirmed to have actually run (see below).
CAUSE RULED OUT: the emitter never reaching the surface — RULED OUT, both
surfaces confirmed populated live (see below).

EVIDENCE:
- Email wiring (real code): `handoffd.bb:747` `suite-duration-briefing-line`
  shells to `extension/out/tools/suite-duration-line.js`, wired at
  `handoffd.bb:834` inside `briefing-email-sweep!` — the same live poll
  loop as report 1. Real command run: `node
  extension/out/tools/suite-duration-line.js` ->
  `"Suite duration trend: 13s latest (+1s vs prior)"` — real computed data,
  not a fixture.
- PWA wiring (real code): `extension/src/notify/costHealthSidecar.ts`
  computes `suiteDurationTrend` into the committed
  `docs/briefings/<date>.json` sidecar; `extension/src/metrics/
  backlogDashboard.ts` (`buildBacklogDashboard`) folds
  `costHealth.suiteDurationTrend` into `backlog.json`'s
  `metrics.suiteDurationTrend` from the latest committed sidecar;
  `pwa/app.js:727-744` `renderSuiteDuration` renders it, called at
  `pwa/app.js:840`; markup lives at `pwa/index.html:115-117`.
  `.github/workflows/backlog-dashboard.yml` triggers on push to `main`
  touching (among others) `extension/src/metrics/**`,
  `extension/src/notify/costHealthSidecar.ts`, `pwa/**` and republishes
  `backlog.json` + the PWA to GitHub Pages.
- LIVE CHECK (real network fetch, run 2026-07-13, NOT a test, NOT a local
  render): `curl https://ldecorps.github.io/swarmforgevc/backlog.json` ->
  HTTP 200, `metrics.suiteDurationTrend.hasLocalData == true`, a real
  5-point `dailySeries` (2026-07-09..2026-07-13), `generatedAtIso:
  "2026-07-13T08:47:19.835Z"`. The live deployed PWA data surface DOES
  carry this metric right now.
- BL-290 (the PWA half) merged `2026-07-11 15:37` — its own changed paths
  (`extension/src/metrics/backlogDashboard.ts`, `costHealthSidecar.ts`,
  `pwa/app.js`, `pwa/index.html`, `pwa/locales.js`) all match the
  workflow's trigger paths, so its own merge should have redeployed
  automatically; the live fetch above confirms SOME subsequent run did
  succeed and the current deploy is correct.

ANSWER: report 2 was accurate at filing time for the same reason as report
1 (no briefing email had EVER successfully sent before 2026-07-11T11:13Z,
so of course an unsent email couldn't show the line); the PWA half is
independently confirmed live and correct as of this investigation via a
real fetch of the actual deployed URL, not a local render or a test.

## REPORT 3 — "architecture diagram on the daily briefing...as well as on the pwa" (filed 2026-07-12T00:26Z)

VERDICT: split — email half STALE (now correct); PWA half NEVER IN SCOPE

CAUSE RULED IN (email half): the running build being stale — RULED IN, same
mechanism as report 1 (BL-260 merged 2026-07-11 01:48, before the
2026-07-11T11:13:43Z first-successful-send; his first-seen briefing emails
used the pre-BL-286 data-URI embedding).
CAUSE RULED OUT (email half): host-only / never-reaching-surface — RULED
OUT, identical wiring evidence as report 1 (`c296e353` "render architecture
diagrams inline" touches `swarmforge/scripts/{briefing_email_lib,
daemon_alarm_lib,handoffd}.bb` — production code, headless poll loop).
PWA half: NEVER BUILT — see below, this is not a "cause" to rule in/out,
the feature does not exist.

EVIDENCE:
- `backlog/done/BL-260-briefing-arch-diagrams-rendered.yaml` scopes this
  explicitly to "the morning briefing **email**" (source quote: "I need the
  architecture diagrams rendered in the morning email as well" — "as well"
  reads as "in addition to the existing plaintext briefing", not "as well
  as the PWA").
- `grep -in "diagram\|mermaid\|architecture" pwa/app.js pwa/index.html
  pwa/locales.js` returns exactly ONE hit, an unrelated i18n comment about
  excluding `.mmd` files from translation — nothing renders a diagram on
  the PWA. No PWA file imports the mermaid renderer, fetches diagram data,
  or has diagram markup.

ANSWER: the email half of this report was accurate at filing time for the
same stale-build reason as report 1, and is confirmed correctly wired and
live today. The PWA half was never built and never speced — it is a
legitimate feature request, not a defect. RAISED SEPARATELY HERE (this
evidence file is a git-tracked, specifier-visible channel; `.swarmforge/`
is gitignored per-checkout local runtime state, not a place a coder-
worktree commit can durably deliver a new raw-intake item into the live
swarm's own intake queue) — recommend the specifier spec "render the
architecture diagram on the PWA (pwa/index.html/app.js), mirroring BL-260's
existing email-side render" as its own new ticket, on its own merits,
rather than it being silently built inside this defect ticket or silently
dropped.

## Cross-cutting fix (code change landed in this parcel)

All three reports trace to the SAME underlying mechanism: a merged fix that
does not reach the process actually serving the human (a stale RUNNING
build). BL-328 built the one general tool for this
(`build_freshness_cli.bb report|sync`), but I found and closed a real,
currently-live gap in its `sync` recompile decision while verifying these
reports (not a hypothetical — confirmed by reading the code and reproducing
red/green with a real test):

`run-sync!`'s `node-stale?` check (`build_freshness_cli.bb:184`, before this
fix) recompiled `extension/` ONLY when a `:front-desk` (bridge/bot) process
was stale. But `handoffd.bb` itself shells out to EIGHT of its own
`extension/out/tools/*.js` compiled CLIs (`render-briefing-diagrams.js`,
`suite-duration-line.js`, `emit-cost-health-sidecar.js`, and five more —
confirmed via `grep -n "extension.*out.*tools" handoffd.bb`), and
`operator_runtime.bb` shells to `operator-decide.js` too. So a merge that
only changed one of THOSE `.ts` sources could leave `handoffd`/
`operator_runtime` reported stale while bridge/bot were already fresh —
`node-stale?` would then be false, `recompile-extension!` would never run,
and `restart-handoffd-group!`/`restart-operator-group!` (plain process
restarts, no compile step) would keep shelling out to the STALE compiled
JS indefinitely. This is exactly the "shipped, closed, invisible" class
this ticket investigates, reproducible inside BL-328's own fix.

Fixed: `node-stale?` now triggers a recompile on ANY staleness, not just
`:front-desk` (cheap when unneeded; the only way to never miss a case).
New test `build-freshness-npm-recompile-01` in
`swarmforge/scripts/test/test_build_freshness_cli.sh` reproduces the gap
red-then-green against the real CLI (a real git fixture, a real handoffd
process, a stubbed `npm` recording whether it was invoked).

## What was explicitly NOT done

- No diagram was hand-rendered or re-sent to "fix" report 1/3 — the render
  path already works; there was nothing to patch there beyond the
  build-freshness gap above.
- The PWA architecture-diagram feature (report 3's PWA half) was NOT built
  in this ticket — raised separately per the ticket's own instruction.
