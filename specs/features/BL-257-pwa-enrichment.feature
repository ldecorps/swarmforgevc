Feature: the phone app gains backlog filtering and per-ticket timelines

  # Operator direction 2026-07-10 (via coordinator intake, "beef up briefing+PWA";
  # operator selected all four PWA candidates). This is the PWA enrichment epic:
  # additive views on the shipped phone app (backlog dashboard BL-097, docs
  # drill-down BL-117, recert BL-150, implemented-greyed BL-253, spec search BL-254,
  # approval list BL-251, suite trend BL-252, localization BL-229/230, a11y BL-238).
  #
  # SLICE SCOPING (BL-233 rule, applied at build time per this ticket's own DELIVERY
  # note): the two views built here (backlog board filter/search, per-ticket
  # timeline) read ONLY backlog.json / docs-tree.json - fully git-reproducible, no
  # live connectivity needed, so they build cleanly into the STATIC deployed
  # pwa/app.js exactly as scoped. The other two candidate views
  # (changed-since-last-visit, live briefing-metric trends) are PARKED in
  # BL-257-pwa-enrichment.slice-3-4-live.feature.draft: both need live, host/
  # bridge-connected data pwa/app.js (a static, zero-connectivity GitHub Pages
  # deployment - confirmed empirically) cannot reach. Per BL-252's own already-
  # approved precedent (machine-local/live data -> the holistic UI + briefing,
  # never backlog.json/pwa/app.js), those two views belong on
  # extension/src/bridge/holisticUiHtml.ts instead - flagged to the specifier/
  # architect (rule_proposal) rather than silently built into the wrong surface or
  # silently dropped.
  #
  # BOUNDARIES (for the two views built here): the webview is presentation-only; it
  # reads backlog.json / docs-tree.json (no new authoritative store); the
  # filter/timeline logic is a pure, testable function separate from the DOM
  # render; new strings are localized (pwa/locales.js); a11y preserved (BL-238).

  Background:
    Given the phone app reading backlog.json and the live metric feed

  # BL-257 backlog-board-filter-search-01
  Scenario: the backlog board can be filtered and searched
    Given the backlog board with tickets of varying status and priority
    When the operator filters or searches the board by status, priority, or text
    Then only the matching tickets remain on the board

  # BL-257 per-ticket-timeline-02
  Scenario: a ticket shows its lifecycle as a timeline
    Given a ticket with git-derived lifecycle events
    When the operator opens that ticket's timeline
    Then it shows the ticket's stages in order with their timestamps

  # BL-257 empty-state-graceful-05 (scoped to the board filter and timeline views)
  Scenario: a view with no data shows a clear empty state
    Given an enrichment view whose data is unavailable
    When the operator opens it
    Then it shows a localized empty state rather than an error or a blank
