# mutation-stamp: sha256=cd1fd058837df98736864a685494b3a6b879b9070a2e98d7f54844d3243c0d46
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-16T16:37:21.256580573Z","feature_name":"stale acceptance-test sandboxes are swept from /tmp before they exhaust the disk","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-413-stale-sandbox-sweep.feature","background_hash":"e1eb1300c0695f1e9ed4b3e882aab728a7c6990e0109fc11efb4f9b5bc40a8f6","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the sweep removes only entries that are a known sandbox, old enough, and idle","scenario_hash":"a26131302afdfbb3d41cb05afc69ecfb81c7a65a686d6cd02915afe174ad768a","mutation_count":16,"result":{"Total":16,"Killed":16,"Survived":0,"Errors":0},"tested_at":"2026-07-16T16:37:21.256580573Z"}]}
# acceptance-mutation-manifest-end

Feature: stale acceptance-test sandboxes are swept from /tmp before they exhaust the disk

  # /tmp accumulated 879,887 entries / 37 GB of never-cleaned acceptance-test
  # sandboxes (sfvc-*, aps-*, tmp.*), inflating the VHDX on C: and degrading
  # every /tmp op. A periodic sweep removes stale sandboxes, but MUST never
  # touch a live sandbox, a non-sandbox entry, or the running swarm's socket dir.

  Background:
    Given a sweep deciding whether a /tmp entry is a stale, removable acceptance sandbox

  # BL-413 stale-sandbox-sweep-01
  Scenario Outline: the sweep removes only entries that are a known sandbox, old enough, and idle
    Given a /tmp entry whose name matches a known sandbox prefix is "<prefix_match>"
    And its age past the stale threshold is "<is_stale>"
    And a live process rooted in it is "<has_live_process>"
    When the sweep evaluates the entry
    Then it is removed is "<removed>"

    Examples:
      | prefix_match | is_stale | has_live_process | removed |
      | yes          | yes      | no               | yes     |
      | yes          | no       | no               | no      |
      | yes          | yes      | yes              | no      |
      | no           | yes      | no               | no      |

  # BL-413 stale-sandbox-sweep-02
  Scenario: the sweep never removes the running swarm's socket directory
    Given the live swarm socket directory /tmp/swarmforge-<uid> exists and is old
    When the sweep runs
    Then the socket directory is left untouched regardless of its age

  # BL-413 stale-sandbox-sweep-03
  Scenario: the sweep targets its own redirectable temp root, never the real /tmp in tests
    Given the sweep's temp root is pointed at a test-owned directory via its override seam
    When the sweep runs
    Then only entries under that test-owned directory are considered for removal
