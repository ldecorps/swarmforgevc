Feature: Bubble reaches the bridge on a fixed named-tunnel URL
  The resident-spy tunnel launcher gains a named-tunnel mode: a hostname the
  operator owns, routed through Cloudflare to the local bridge port, so the
  phone keeps working across cloudflared restarts. Quick tunnels stay the
  default. Adopted under BL-787 from hand work that landed ticket-less in the
  master tree on 2026-08-02 (BL-506 stamp).

  Background:
    Given a project root whose bridge listens on the configured port
    And cloudflared and the idle-keepalive binary are stubbed, with no live Cloudflare account

  # BL-787 named-01
  Scenario: named mode serves the operator's fixed hostname
    Given operator config names a tunnel and the hostname "bubble.example.com"
    When the resident-spy tunnel launcher runs
    Then it runs cloudflared against that named tunnel
    And it prints "https://bubble.example.com"
    And the tunnel state file records mode "named"

  # BL-787 named-02
  Scenario: named mode with no configured hostname refuses to start
    Given named tunnel mode is requested with no hostname in the environment or operator config
    When the resident-spy tunnel launcher runs
    Then it exits non-zero naming the named-tunnel setup script
    And no tunnel state file is written
    And no pairing notification is sent

  # BL-787 named-03
  Scenario: a named tunnel that never reaches the edge is not reported as up
    Given the named tunnel process stays alive but never registers a connection
    When the resident-spy tunnel launcher runs
    Then it exits non-zero pointing at the tunnel log
    And no tunnel state file is written
    And no pairing notification is sent

  # BL-787 quick-01
  Scenario: with no named config the quick tunnel remains the default
    Given no named tunnel configuration is present
    When the resident-spy tunnel launcher runs
    Then it starts a quick tunnel
    And it prints the ephemeral tunnel URL read from the tunnel log
    And the tunnel state file records mode "quick"

  # BL-787 keepalive-01
  Scenario Outline: the idle-sleep keepalive starts unless it is skipped
    Given <keepalive setting>
    When the resident-spy tunnel launcher runs
    Then the keepalive pidfile is <pidfile state>

    Examples:
      | keepalive setting            | pidfile state |
      | the keepalive is enabled     | written       |
      | the keepalive skip flag is set | absent      |

  # BL-787 keepalive-02
  Scenario: stopping ancillary services tears the keepalive down
    Given the launcher has started a keepalive process and written its pidfile
    When the ancillary stop path runs
    Then the keepalive process is signalled
    And no live process remains under that pidfile

  # BL-787 setup-01
  Scenario: setup refuses while the zone is not served by Cloudflare
    Given the zone nameservers are not Cloudflare-backed
    When the named-tunnel setup script runs without the pending-DNS override
    Then it exits non-zero with the nameserver migration checklist
    And it creates no tunnel and writes no cloudflared config

  # BL-787 setup-02
  Scenario: setup writes the operator config and re-running changes nothing
    Given the zone nameservers are Cloudflare-backed
    And the named tunnel already exists on the account
    When the named-tunnel setup script runs twice
    Then a cloudflared ingress config maps the hostname to the bridge port
    And the operator named-tunnel env file names that tunnel and hostname
    And the second run creates no second tunnel
