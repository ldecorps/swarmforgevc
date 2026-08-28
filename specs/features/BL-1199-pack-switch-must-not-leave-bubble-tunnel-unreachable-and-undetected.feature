# mutation-stamp: sha256=754de408e035892683088d124faf5db047d8aaae51f6fc87b91a343cf05c7206
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-27T23:35:23.748256269Z","feature_name":"a pack switch or ensure cycle never leaves the Bubble named tunnel dead and undetected","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1199-pack-switch-must-not-leave-bubble-tunnel-unreachable-and-undetected.feature","background_hash":"27d8a1a1f584f40819a9c3573f9741e295656863ddd35106b890372076c1c7f5","implementation_hash":"unknown","scenarios":[{"index":1,"name":"Swarm status reports the editor tunnel and the named tunnel as separate rows","scenario_hash":"4c6c2da5d89513e6871e6d836bb8fd5e54dc86c6346d4858246558e228b723c0","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-27T23:35:23.748256269Z"}]}
# acceptance-mutation-manifest-end

Feature: a pack switch or ensure cycle never leaves the Bubble named tunnel dead and undetected

  # BL-1199 (epic swarm-reliability). 2026-08-27 19:16 BST, operator intake
  # (.swarmforge/operator/INTAKE-pack-switch-kills-bubble-cloudflared.md):
  # switching to the Anthropic swarm (./start-swarm-anthropic.sh) left the
  # Bubble named tunnel (swarmforge-bubble -> bubble.musicalsifu.com) dead —
  # no cloudflared process, a recorded pid (3732619) no longer alive, and no
  # graceful-shutdown line in resident-spy-cloudflared.log after its
  # successful 17:53:39Z register. `./swarm status` still showed
  # "cloudflare-tunnel UP", but that row is the editor tunnel (`code tunnel`),
  # a different process entirely — confirmed by reading swarm_status.bb:280,
  # whose single "cloudflare-tunnel" row is sourced from operator/tunnel.pid
  # and never observes the named tunnel at all. start_ancillary_services.sh
  # launches the named tunnel and warns only on a non-zero launcher exit, so
  # a launcher that succeeded and a process that later died are
  # indistinguishable to every surface the operator reads. Ops recovered by
  # hand (launch_resident_spy_tunnel.sh + ./swarm ensure).

  Background:
    Given a named tunnel is configured for the operator root

  # BL-1199 named-tunnel-liveness-asserted-not-inferred-01
  Scenario: Ancillary start asserts the named tunnel is live rather than trusting the launcher's exit code
    Given the named tunnel launcher exited successfully
    And the recorded named-tunnel pid is no longer alive
    When ancillary start reports its named-tunnel outcome
    Then the named tunnel is reported down
    And the report names the named tunnel rather than the editor tunnel

  # BL-1199 status-separates-editor-and-named-tunnel-rows-02
  Scenario Outline: Swarm status reports the editor tunnel and the named tunnel as separate rows
    Given the editor tunnel is <editor> and the named tunnel is <named>
    When swarm status renders its tunnel rows
    Then the "vscode-tunnel" row reports <editor>
    And the "bubble-cloudflared" row reports <named>

    Examples:
      | editor | named |
      | up     | down  |
      | down   | up    |
