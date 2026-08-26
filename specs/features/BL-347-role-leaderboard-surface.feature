Feature: The Role Leaderboard reaches the human on the backlog dashboard

# BL-347: slice 2 of the role-benchmarking epic. BL-340 (slice 1) produces the numbers; this
# ticket PRESENTS them — the Best / Best Value / Cheapest Acceptable table, per role. The human
# picked this scope ("A") and, separately, picked the static PWA as the surface. The PWA is a
# git-SHA-reproducible projection with no live/host connectivity, so the leaderboard may only
# ride data that was COMMITTED — it reads BL-340's committed report artifact, exactly as the
# cost-health section reads its committed sidecar. It never reaches for live benchmark state.

Background:
  Given the backlog dashboard is generated from committed repository state

# BL-347 role-leaderboard-surface-01
Scenario: The leaderboard names a best, a best value, and a cheapest acceptable model per role
  Given a committed benchmark report ranking several models for a role
  When the dashboard is generated
  Then the leaderboard shows that role's best, best value, and cheapest acceptable model

# BL-347 role-leaderboard-surface-02
Scenario: The quality threshold for cheapest acceptable is stated, not implied
  Given a committed benchmark report that states its quality threshold
  When the dashboard is generated
  Then the leaderboard shows the quality threshold the cheapest acceptable model had to clear

# BL-347 role-leaderboard-surface-03
Scenario: The reader can tell how old the numbers are
  Given a committed benchmark report produced by a known run
  When the dashboard is generated
  Then the leaderboard shows when that report was produced

# BL-347 role-leaderboard-surface-04
Scenario: A difference between models can be told from noise
  Given a committed benchmark report that records run-to-run variance
  When the dashboard is generated
  Then the leaderboard shows that variance alongside the ranking

# BL-347 role-leaderboard-surface-05
Scenario: The leaderboard is hidden entirely when no benchmark has been run
  Given no benchmark report has been committed
  When the dashboard is generated
  Then the dashboard carries no leaderboard
  And the leaderboard section is not shown empty

# BL-347 role-leaderboard-surface-06
Scenario: The leaderboard rides only committed data
  Given a benchmark result that exists only as live machine-local state
  When the dashboard is generated
  Then that result does not appear in the dashboard

# BL-347 role-leaderboard-surface-07
Scenario: The human can collapse the leaderboard and find it collapsed next time
  Given the dashboard is showing the leaderboard
  When the human collapses the leaderboard section and returns later
  Then the leaderboard section is still collapsed
