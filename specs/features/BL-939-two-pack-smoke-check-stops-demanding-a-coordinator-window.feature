Feature: the stabilize-two-pack smoke check stops demanding a coordinator window line

  # BL-939 (swarm-reliability). smoke_check_stabilize_two_pack.sh parses
  # the profile's own `^window ` lines and compares the role names it finds
  # against expected=(coordinator coder cleaner), failing with "profile
  # defines roles [coder cleaner], expected [coordinator coder cleaner]".
  #
  # That expectation cannot be satisfied. BL-243 (2026-07-10) made the
  # coordinator RESERVED INFRASTRUCTURE: swarmforge.sh's parse_config
  # rejects a `window coordinator` line outright and exits 1 with
  # "coordinator is reserved infrastructure and may not be declared as a
  # window" - provision_coordinator always adds exactly one automatically.
  # stabilize-two-pack.conf carries a comment saying precisely this, and no
  # profile in swarmforge/profiles/ declares a coordinator window.
  #
  # So the PROFILE is correct and the CHECK is stale: it was written for
  # BL-203, before BL-243 changed where the coordinator comes from. The
  # trap is that acting on the check's own failure message - adding the
  # missing `window coordinator` line - would break ./swarm for this pack
  # outright. Nothing caught the drift because the check itself could not
  # run: it died on `mapfile: command not found` at line 27 on a stock bash
  # 3.2 host, before ever reaching the comparison. BL-937's port made it
  # executable, which is what surfaced this.
  #
  # Step handlers drive the real smoke check and the real pack parser,
  # never a reimplementation of either. The <declaration> and <result>
  # columns are validated against explicit KNOWN_VALUES.

  # BL-939 two-pack-smoke-check-stops-demanding-a-coordinator-window-01
  Scenario: the smoke check passes against the profile as it stands
    Given the stabilize-two-pack profile as it stands, declaring coder and cleaner
    When the stabilize-two-pack smoke check runs
    Then it passes
    And it does not report a missing coordinator role

  # BL-939 two-pack-smoke-check-stops-demanding-a-coordinator-window-02
  Scenario Outline: the pack parser decides whether a profile may declare the coordinator
    Given a profile that declares <declaration>
    When the pack configuration is parsed
    Then the parse <result>

    Examples:
      | declaration              | result                                          |
      | coder and cleaner only   | succeeds and provisions the coordinator itself  |
      | a coordinator window too | is rejected as reserved infrastructure          |

  # BL-939 two-pack-smoke-check-stops-demanding-a-coordinator-window-03
  Scenario: the smoke check still fails when a pack role really is missing
    Given the stabilize-two-pack profile with its cleaner window removed
    When the stabilize-two-pack smoke check runs
    Then it fails naming the missing cleaner role
