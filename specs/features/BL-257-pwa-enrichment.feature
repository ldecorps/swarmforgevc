Feature: the phone app gains backlog filtering, per-ticket timelines, a since-last-visit view, and live metric trends

  # Operator direction 2026-07-10 (via coordinator intake, "beef up briefing+PWA";
  # operator selected all four PWA candidates). This is the PWA enrichment epic:
  # additive views on the shipped phone app (backlog dashboard BL-097, docs
  # drill-down BL-117, recert BL-150, implemented-greyed BL-253, spec search BL-254,
  # approval list BL-251, suite trend BL-252, localization BL-229/230, a11y BL-238).
  #
  # BOUNDARIES: the webview is presentation-only; it reads backlog.json /
  # docs-tree.json (no new authoritative store); machine-local live metrics come via
  # the live holistic feed, NOT the git-projection backlog.json (BL-252 boundary);
  # new strings are localized (pwa/locales.js); no browser storage — any client
  # state (e.g. last-visit marker) persists via the extension host.
  #
  # SLICED: each view is a slice the operator can keep or drop. At build time scope
  # the live acceptance file to BUILT slices; park the rest in a
  # BL-257-*.feature.draft (BL-233 slice-scoping rule).

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

  # BL-257 changed-since-last-visit-03
  Scenario: the app highlights what changed since the last visit
    Given a last-visit marker persisted by the extension host
    When the operator opens the app after some tickets changed state
    Then the tickets that changed state since the last visit are highlighted

  # BL-257 live-briefing-trends-04
  Scenario: the app surfaces the briefing metrics as live trends
    Given the live metric feed with throughput, QA-bounce, and suite-duration trends
    When the operator opens the trends view
    Then each metric is shown with its latest value and trend direction

  # BL-257 empty-state-graceful-05
  Scenario: a view with no data shows a clear empty state
    Given an enrichment view whose data is unavailable
    When the operator opens it
    Then it shows a localized empty state rather than an error or a blank
