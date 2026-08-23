# mutation-stamp: sha256=86efd0285f39182cf5d69799d03bf4f36fda53c45fd370192bb422cd81a996ec
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T23:35:32.455399786Z","feature_name":"BL-1069 the swarm judges its tmux by the server it is actually running","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1069-swarm-stamp-tmux-wsl-segfault-upgrade-hotfix.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the version verdict is read from the server, not the client","scenario_hash":"e243dbc7af37cf7cbf727790fe354712fbac33293bd98993bc749e7ce563716a","mutation_count":15,"result":{"Total":15,"Killed":15,"Survived":0,"Errors":0},"tested_at":"2026-08-22T23:35:32.455399786Z"},{"index":1,"name":"preferring a tmux binary never lowers the version in use","scenario_hash":"1d270b4d5734a6e223ef1006c815e7c3b93d21ad5a0d7803f6d5aa5625e8fe34","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-08-22T23:35:32.455399786Z"},{"index":3,"name":"the installer produces a verified tmux or refuses by name","scenario_hash":"90fcb1cb60bc124ab0676258c410aa776e88bb622bdb79b694c1180ea757dd6b","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-22T23:35:32.455399786Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1069 the swarm judges its tmux by the server it is actually running
  Ubuntu's tmux 3.4 SIGSEGVs in resize.c on a NULL window (fault at offset
  0x208) whenever WINDOW_SIZE_MANUAL is set; the upstream guard lands in 3.7.
  A human landed a hotfix by hand (commit 61c62f579) that prefers a user-local
  tmux, warns below 3.7, soft-hardens two server options, and documents a
  no-root install. This feature is the gate that hotfix never passed.

  One of those two knobs is gone: BL-1075 retired `window-size largest`, which
  the tiling panel overrode per window and so never held. `focus-events off` is
  the surviving soft knob, and scenario 03 gates it.

  The incident's own live probe is the case that matters: the client on PATH
  was ALREADY 3.7b while `#{version}` on the swarm socket still answered 3.4,
  because the server predated the install. Any version judgement that reads
  the client is silent in exactly the state the crash loop lives in.

  # BL-1069 tmux-version-verdict-01
  Scenario Outline: the version verdict is read from the server, not the client
    Given the tmux client on PATH reports "<client>"
    And the control-plane server on the swarm socket reports "<server>"
    When the swarm checks its tmux version
    Then the operator is "<verdict>"

    Examples:
      | client | server | verdict |
      | 3.7b   | 3.4    | warned  |
      | 3.4    | 3.4    | warned  |
      | 3.4    | none   | warned  |
      | 3.7b   | 3.7b   | silent  |
      | 3.7b   | none   | silent  |

  # BL-1069 tmux-binary-preference-02
  Scenario Outline: preferring a tmux binary never lowers the version in use
    Given a tmux at "~/.local/bin/tmux" reporting "<local>"
    And a tmux earlier on PATH reporting "<path>"
    When the swarm resolves which tmux to launch with
    Then it launches with the "<chosen>" tmux

    Examples:
      | local  | path | chosen |
      | 3.7b   | 3.4  | local  |
      | 3.4    | 3.7b | path   |
      | 3.7b   | none | local  |
      | absent | 3.7b | path   |

  # BL-1069 tmux-hardening-is-soft-03
  Scenario: a rejected stability knob never fails the caller
    Given a live control plane whose tmux rejects the "focus-events" option
    When the swarm hardens the server during an ensure
    Then the ensure still reports the control plane up
    And the rejection is not recorded as a control-plane failure

  # BL-1069 tmux-install-refuses-04
  Scenario Outline: the installer produces a verified tmux or refuses by name
    Given the install script is asked for a build it cannot verify because "<obstacle>"
    When the install script runs
    Then no tmux is left at "~/.local/bin/tmux"
    And it refuses with a reason naming "<obstacle>"

    Examples:
      | obstacle                              |
      | the host architecture has no build    |
      | the downloaded build fails its digest |
