# mutation-stamp: sha256=c2bf4d39a2593f869ddcad6c22ef0782294323d74961b93e2d74506402e70d12
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-26T00:06:39.378824769Z","feature_name":"BL-1766 the register CLI's \"no date reads today\" property compares against the CLI's own local day","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1766-register-cli-today-property-reads-the-local-day.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the property passes on either side of the UTC date line","scenario_hash":"5e969a807badd3be7ed2f8a48c4d90a7eecf3f3f5f1e98c2b6a42e7d917281c1","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-26T00:06:39.378824769Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1766 the register CLI's "no date reads today" property compares against the CLI's own local day
  standing_red_register_cli.bb, given no --now, takes today from
  java.time.LocalDate/now, which is the local calendar day. The BL-1648
  invariant 2 property builds its "first seen today" fixture from
  new Date().toISOString(), which is the UTC day. Whenever the two days
  differ (00:00 to 01:00 BST every night) the CLI reports age 1 and the
  property goes red: QA's property lane on 2026-09-26 at 00:1x BST. The
  property keeps running the CLI with no date and keeps asserting age 0;
  it computes "today" the way the CLI does.

  At any instant one of UTC+14 and UTC-12 is on a different calendar day
  from UTC, so running the property under both proves it no longer reads
  the UTC day, whatever the hour of the run.

  # BL-1766 register-today-property-reads-local-day-01
  Scenario Outline: the property passes on either side of the UTC date line
    Given the process time zone is "<zone>"
    When the property "no date argument reads today" in "extension/test/bl1648RegisterCliInjectedDateInvariants.property.test.js" runs alone
    Then it passes
    And exactly 1 test ran

    Examples:
      | zone       |
      | Etc/GMT-14 |
      | Etc/GMT+12 |
