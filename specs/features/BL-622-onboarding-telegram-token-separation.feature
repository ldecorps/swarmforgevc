Feature: A swarm never polls Telegram with an inherited bot token

  # BL-622, human-confirmed incident 2026-07-24: an onboarding attempt
  # cloned TELEGRAM_BOT_TOKEN; the rival getUpdates poller silently stole
  # this swarm's inbound messages for ~9 hours. One token has exactly one
  # poller - a Telegram API invariant. Epic fleet-topology.
  #
  # Verified inheritance channels (2026-07-25): every launcher sources
  # ~/.zshenv unconditionally (start-swarm.sh:74,
  # start_ancillary_services.sh:26); per-target .swarmforge/*.env hooks;
  # and fleet_telegram_creds_lib.bb:53-60 falls back to ambient env
  # whenever no per-swarm creds file exists - while swarm_identity_lib.bb
  # defaults the swarm name to "primary" when .swarmforge/swarm-identity is
  # absent, so a second checkout resolves the primary's token by default.
  # BL-436 shipped per-swarm creds files but nothing REQUIRES them; no
  # cross-swarm uniqueness check exists; swarm_ensure.bb:314-335 re-enables
  # a desk from a stale pid file alone.
  #
  # The invariant this ticket lands: ambient-env credential fallback is
  # reserved for the ONE recorded primary root; every other swarm needs its
  # own per-swarm creds (BL-380 provisioning) or its front desk stays down
  # with a loud, actionable line. Refusal is always visible, never silent.

  # BL-622 non-primary-never-inherits-env-token-01
  Scenario: a swarm that is not the recorded primary never resolves the ambient env token
    Given the recorded primary root names a different project root
    And no per-swarm Telegram creds file exists for this swarm
    And the ambient environment carries the primary Telegram credentials
    When Telegram credentials are resolved for this project root
    Then no bot token is resolved
    And the front desk does not launch
    And one loud line explains this swarm needs its own token and names the provisioning command

  # BL-622 primary-env-fallback-preserved-02
  Scenario: the recorded primary still resolves ambient env credentials
    Given this project root is the recorded primary root
    And the ambient environment carries the primary Telegram credentials
    When Telegram credentials are resolved for this project root
    Then the ambient token is resolved and the front desk may launch

  # BL-622 first-primary-launch-records-root-03
  Scenario: the first primary launch durably records its project root
    Given no primary root is recorded on this host
    When a swarm launches as swarm name "primary"
    Then the primary root record is written naming this project root

  # BL-622 named-swarm-creds-file-wins-04
  Scenario: a named swarm with its own creds file resolves that token
    Given a fleet creds file exists for swarm name "fes" carrying its own token
    And the ambient environment carries the primary Telegram credentials
    When Telegram credentials are resolved for the fes swarm root
    Then the fes token is resolved and not the ambient token

  # BL-622 duplicate-token-refused-05
  Scenario: a token already recorded for another fleet swarm is refused at the launch gate
    Given the resolved token equals another fleet swarm's recorded token
    When the front-desk launch gate runs
    Then the launch is refused
    And one loud line names the conflicting swarm

  # BL-622 pid-file-alone-never-reenables-06
  Scenario: a stale pid file alone never re-enables a front desk that cannot resolve its own credentials
    Given a stale front-desk supervisor pid file exists in a non-primary swarm with no creds file
    When swarm ensure evaluates front-desk enablement
    Then the front desk does not launch
    And the loud needs-own-token line is logged

  # BL-622 bringup-docs-stop-exporting-primary-token-07
  Scenario: the bring-up documentation instructs per-swarm provisioning instead of exporting the primary token
    Given the shipped repository documentation
    When the second-swarm bring-up how-to and the onboarding tutorial are read
    Then they instruct provisioning a distinct per-swarm token before enabling the front desk
    And they no longer instruct launching from a shell with the primary token exported
