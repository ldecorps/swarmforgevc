Feature: mutation runs report progress and ETA durably

# BL-132 durable-progress-01
Scenario: a running mutation pass exposes machine-readable progress
  Given the hardener is running a Stryker mutation pass
  When it is partway through
  Then a durable file reports tested/total, percent, survived, and an ETA
  And the file updates as the run advances and is finalized on completion
  And it is readable without the extension/webview (plain file)

# BL-132 hang-vs-progress-02
Scenario: a stalled run is distinguishable from a progressing one
  Given the progress file's updated_at timestamp
  Then a consumer can tell a live-advancing run from one that has stopped
    updating (a hang), per the constitution's long-run progress rule

# BL-132 tile-03 (layered, non-blocking)
Scenario: the tile shows mutation progress when the webview is healthy
  Given a durable progress file for a role
  Then the extension surfaces "% done · ~ETA" on that role's tile
  And absence/malformed file degrades gracefully (no crash, no false hang)

# Non-behavioral gates:
#  - Do not re-implement Stryker's progress/ETA; reuse its `progress`
#    reporter output (small reporter plugin or a tail-to-json wrapper).
#  - The durable file is the contract; the tile is a view — this must not
#    depend on the (currently buggy) webview.
