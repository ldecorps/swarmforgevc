Feature: a serverless dashboard projects backlog state and history

# BL-097 dashboard-01
Scenario: push produces a fresh published projection
  Given a push to main that closes a ticket into done/
  When the Action completes
  Then the published backlog.json carries that push's SHA
  And its state board and metrics reflect the close

# BL-097 dashboard-02
Scenario: metrics agree with the metrics CLI
  Given a backlog.json generated at a SHA
  When the BL-096 metrics CLI runs at the same SHA
  Then velocity, burndown, and cycle-time figures are identical

# BL-097 dashboard-03
Scenario: client renders board and charts from one fetch
  Given a browser (mobile viewport) loading the Pages site
  When backlog.json is fetched
  Then the state board, burndown, velocity, and cycle-time views render
  And no other network resource outside the Pages origin is required

# BL-097 dashboard-04
Scenario: offline shows last-known state honestly
  Given the PWA has previously loaded and cached backlog.json
  When the device is offline and the app is opened
  Then the last-cached board and charts render
  And an "as of <generation time>" indicator is visible

# BL-097 dashboard-06
Scenario: background sync keeps the cache recent on Android
  Given the PWA is installed on Android Chrome with periodic sync
    granted
  When the browser fires the registered periodic sync event
  Then the service worker re-fetches backlog.json into the cache
  And a later offline open renders that refreshed data with its
    "as of" time

# BL-097 dashboard-07
Scenario: platforms without periodic sync degrade silently
  Given a browser that does not support the Periodic Background Sync API
  When the PWA loads and runs
  Then no error or prompt is shown
  And freshness behaves as open-time fetch plus cache

# BL-097 dashboard-05
Scenario: schema is versioned and documented
  When backlog.json is generated
  Then it contains a schema_version
  And every field appears in the documented schema

# Non-behavioral gates:
#  - Generator logic (state rendering, JSON assembly) is pure/unit-tested
#    in the shared modules; the workflow YAML holds no logic beyond
#    invoking it and publishing.
#  - No metric derivation exists in client JS (renderer only).
#  - Action failures are visible in CI but never gate the pipeline.
