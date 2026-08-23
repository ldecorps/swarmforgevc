# mutation-stamp: sha256=c1d1fa6d4a18cc0fa5413e3d8056b2fa8284d5f7529b8e6fad98d6dc3fa1d278
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T22:06:56.039589046Z","feature_name":"The host switchover doctor names what a host move left behind","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1057-the-doctor-names-what-a-host-move-left-behind.feature","background_hash":"da7ab12e506c0caf742c77966f77589e8107caf14f4a43ef9d54e3a0863c37fd","implementation_hash":"unknown","scenarios":[{"index":0,"name":"Each host-pinned location gets exactly one verdict","scenario_hash":"5d699155a8128626602bdcc6f7cb21dd5339fe2deb5c09e6fa965faa75bb6416","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-08-22T22:06:56.039589046Z"},{"index":3,"name":"The exit code says whether this host needs attention","scenario_hash":"7f86b258511859904e4ae8d307008bd532b76834fccbc7be5282f5195bc6f23a","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-22T22:06:56.039589046Z"}]}
# acceptance-mutation-manifest-end

Feature: The host switchover doctor names what a host move left behind

  This swarm's host moved from a Mac to WSL2 on 2026-08-22. The daemons and
  tmux sessions came up fine, but two host-pinned locations were silently left
  describing the old machine: the extension dev workspace's target path, plus
  the Cloudflare named-tunnel registration whose absence served a live Error
  1033 to a real user. Nothing reported either one. Both were found by hand,
  the second only because a user-facing surface broke.

  The doctor is the command a human runs right after a move. It walks a
  declared inventory of host-pinned locations, gives each one exactly one
  verdict, then exits non-zero if any of them is not OK.

  The doctor only ever reports. It never repairs, which is a durable property
  rather than a boundary a later slice relaxes: a diagnostic you can safely run
  on a half-migrated host is worth more than one that might rewrite config
  while the move is still in progress. Any future repair capability is a
  separate command, never a flag on this one.

  Background:
    Given a swarm checkout whose repo root is the injected root
    And a declared inventory of host-pinned locations the forge reads

  # BL-1057 host-switchover-doctor-01
  Scenario Outline: Each host-pinned location gets exactly one verdict
    Given the host-pinned location "<location>" <condition>
    When the operator runs the host switchover doctor
    Then the report records "<location>" with verdict "<verdict>"

    Examples:
      | location                            | condition                              | verdict |
      | extension/.vscode/settings.json     | names a repo root that is not this one | STALE   |
      | extension/.vscode/settings.json     | names this repo root                   | OK      |
      | ~/.swarmforge/tunnels/operator-root | is absent                              | MISSING |
      | ~/.cloudflared/config.yml           | exists but cannot be read              | BLOCKED |

  # BL-1057 host-switchover-doctor-02
  Scenario: A finding names the value it found and the step that fixes it
    Given the host-pinned location "extension/.vscode/settings.json" names a repo root that is not this one
    When the operator runs the host switchover doctor
    Then the finding for "extension/.vscode/settings.json" quotes the stale value it found
    And the finding for "extension/.vscode/settings.json" names a remediation step

  # BL-1057 host-switchover-doctor-03
  Scenario: An absent tunnel registration points at the runbook that fixes it
    Given the host-pinned location "~/.swarmforge/tunnels/operator-root" is absent
    When the operator runs the host switchover doctor
    Then the finding for "~/.swarmforge/tunnels/operator-root" names "docs/how-to/named-tunnel-bubble-musicalsifu.md"

  # BL-1057 host-switchover-doctor-04
  Scenario Outline: The exit code says whether this host needs attention
    Given an inventory in which <state>
    When the operator runs the host switchover doctor
    Then the doctor exit code is "<exit>"

    Examples:
      | state                                                  | exit |
      | every location is present and names this repo root     | 0    |
      | one location names a repo root that is not this one    | 1    |
      | one location is absent                                 | 1    |

  # BL-1057 host-switchover-doctor-05
  Scenario: The doctor writes nothing it inspected
    Given the host-pinned location "extension/.vscode/settings.json" names a repo root that is not this one
    When the operator runs the host switchover doctor
    Then every inspected location is byte-identical to what it was before the run

  # BL-1057 host-switchover-doctor-06
  Scenario: No declared check is silently dropped from the report
    Given the host-pinned location "~/.cloudflared/config.yml" exists but cannot be read
    When the operator runs the host switchover doctor
    Then the report contains exactly one entry for every location in the declared inventory
