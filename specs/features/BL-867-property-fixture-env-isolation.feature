Feature: BL-867 the BL-787 named-tunnel property file is isolated from the host environment

  The BL-787 property file spreads the host's real process.env into every
  fixture subprocess it spawns. The operator host genuinely exports the live
  named-tunnel identity so the resident-spy tunnel can run, so the cases that
  mean that identity to be ABSENT receive it anyway: the file's verdict becomes
  a function of who is running it rather than of the repository under test.
  These scenarios pin the verdict to the repository.

  Background:
    Given the BL-787 named-tunnel property file
    And a host environment exporting the operator's live named-tunnel identity

  # BL-867 property-fixture-env-isolation-01
  Scenario: the property file passes on a host that exports the live identity
    When the property file is run
    Then the run passes

  # BL-867 property-fixture-env-isolation-02
  Scenario: the property file also passes on a host carrying no named-tunnel identity
    Given the named-tunnel identity is removed from the host environment
    When the property file is run
    Then the run passes

  # BL-867 property-fixture-env-isolation-03
  Scenario Outline: a case that means the named-tunnel identity to be absent observes it absent
    When the absent-identity case for <script> runs
    Then <script> exits non-zero
    And its output names the environment variable it is missing
    And its output never contains the operator's own domain

    Examples:
      | script                           |
      | launch_resident_spy_tunnel.sh    |
      | setup_bubble_named_tunnel.sh     |
      | check_bubble_named_tunnel_dns.sh |

  # BL-867 property-fixture-env-isolation-04
  Scenario: the quick-tunnel case exercises the quick path even though the host exports a named tunnel
    When the quick-tunnel pidfile case runs
    Then the launcher serves a quick-tunnel URL
    And it does not serve the exported named hostname
