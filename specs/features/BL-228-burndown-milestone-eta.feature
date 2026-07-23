Feature: The burndown shows each milestone's forecast ETA plus an overall ETA for all remaining work

  # A per-milestone forecast already exists: deliveryMetrics.computeForecasts
  # produces forecasts.milestones = [{milestone, p50Iso, p85Iso}] (throughput +
  # cycle-time + dependency-aware), and it already feeds the per-ticket ETAs shown
  # on the board (pwa/app.js:195, t.p50Iso). backlog.json already carries
  # forecasts (backlogDashboard.ts:174) and the CLI already has metrics.forecasts.
  # This item SURFACES that milestone forecast on the burndown — it does NOT add a
  # new ETA computation. Reusing it keeps the burndown ETA consistent with the
  # per-ticket ETAs already on the same dashboard (operator decision 2026-07-10).

  Background:
    Given delivery metrics whose forecasts.milestones carry each milestone's ETA

  # BL-228 milestone-eta-01
  Scenario: each milestone on the burndown shows its forecast completion ETA
    Given a burndown milestone with a forecast p50 date
    When the burndown is rendered
    Then that milestone shows its forecast ETA alongside its remaining count

  # BL-228 backlog-eta-02
  Scenario: an overall ETA for all remaining open work is shown
    Given open tickets across milestones with forecasts
    When the burndown is rendered
    Then an overall "all remaining work" ETA — the latest projected completion — is shown

  # BL-228 no-eta-03
  Scenario: a milestone with no computable forecast shows no ETA, not a bogus date
    Given a burndown milestone whose forecast p50 is null for insufficient throughput or history
    When the burndown is rendered
    Then that milestone shows a "no ETA yet" indication, never an infinite or fabricated date

  # BL-228 both-surfaces-04
  Scenario Outline: the milestone ETA appears on both surfaces
    Given a burndown milestone with a forecast p50 date
    When the burndown is rendered on the <surface>
    Then the milestone ETA is present

    Examples:
      | surface           |
      | PWA dashboard     |
      | swarm-metrics CLI |

# Non-behavioral gates:
#  - Reuse forecasts.milestones (and forecasts.tickets for the overall ETA); do
#    NOT add a parallel ETA computation. The overall ETA is the latest projected
#    completion across all open tickets (max p50 over forecasts.tickets), derived
#    from the existing forecast, not a new model.
#  - p85 (the pessimistic bound) MAY be shown as a p50–p85 range; p50 is the
#    primary date. "no ETA yet" reuses the same null-p50 handling the per-ticket
#    board render already relies on (no infinite/fabricated dates).
#  - Both renderers change: pwa/app.js renderBurndown and
#    extension/src/tools/swarm-metrics.ts formatBurndownLine. The metric layer
#    (deliveryMetrics.ts) is unchanged — the data is already present in both.
