Feature: the phone app and the daily briefing show how many tickets are not done

  # Operator direction 2026-07-10 (via coordinator, INTAKE-not-done-count.md): "add
  # to the phone app + daily briefing the number of tickets 'not done'." Both surfaces
  # show a single count of the open (not-done) tickets.
  #
  # "Not done" = every ticket whose lifecycle state is NOT done — the active and
  # paused tickets, excluding done. (A finer active/paused split is an explicit
  # nice-to-have, out of scope here; the ask is the single total.)
  #
  # Verified live layer: the committed projection backlogDashboard.ts already buckets
  # board.active[] / board.paused[] / doneByMilestone (backlog.json, BL-097), so the
  # count is a PURE derivation over tickets already in that data (active.length +
  # paused.length) — presentation/composition only, no new store (BL-252 projection
  # boundary; the count is git-SHA-reproducible from the committed backlog). SINGLE
  # SOURCE: one pure count function feeds both surfaces — emit it as a notDoneCount
  # field in backlog.json (PWA reads the field; the briefing composes the same
  # number via the briefing_email_lib.bb append-line seam BL-252 used) so the two
  # never disagree and the count is not recomputed two different ways (TS host /
  # JS client). Any new label is localized via pwa/locales.js (BL-229/230).

  Background:
    Given the committed backlog projection listing each ticket's lifecycle state

  # BL-263 count-excludes-done-01
  Scenario: the not-done count totals the open tickets and excludes done ones
    Given a backlog with active, paused, and done tickets
    When the not-done total is derived from the projection
    Then it counts the active and paused tickets and excludes the done ones

  # BL-263 surfaces-agree-02
  Scenario: the phone app and the daily briefing show the same total
    Given a single not-done total produced once for both surfaces
    When the phone dashboard and the daily briefing each display it
    Then both show that identical total

  # BL-263 zero-state-03
  Scenario: with every ticket done the total shows zero
    Given a backlog whose tickets are all done
    When the not-done total is derived from the projection
    Then each surface shows a not-done total of zero rather than a blank or an error

  # BL-263 derived-not-stored-04
  Scenario: the total is a derivation of the committed projection, not a new store
    Given the committed backlog projection
    When the not-done total is produced
    Then it is a pure derivation of the listed tickets and adds no authoritative store
