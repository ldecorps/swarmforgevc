# mutation-stamp: sha256=a3c24a2d4fe547bc658e3fdb22892c9551ceabc394fc9dbf1139c5243c1b0ddf
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T19:05:21.169383049Z","feature_name":"A fixture-tunnel sweep never signals a fixture a live run still owns","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1287-a-fixture-sweep-must-not-signal-a-live-runs-fixtures.feature","background_hash":"eb177f3bd18d46805d91443d68c8ee2dafe6319fbf8844d50e901c2965cde047","implementation_hash":"unknown","scenarios":[{"index":0,"name":"A fixture is swept only when the run that created it is gone","scenario_hash":"ea9b045adfefbf32605e82b1c33b94309aeddda3bcb86e9572b682f8b0ada332","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-05T19:05:21.169383049Z"}]}
# acceptance-mutation-manifest-end

Feature: A fixture-tunnel sweep never signals a fixture a live run still owns

  extension/test/helpers/fixtureTunnelName.js's leakedFixtureTunnelPids is
  documented, and used, as "fixture processes leaked by an EARLIER run". Its
  predicate cannot make that claim good: it selects every process on the host
  whose command line names a cloudflared under the OS temp directory carrying
  a " run <name>" token, with no scoping to the run that is asking.

  The property lane runs pool: 'forks' with more than one fork, and
  bl857TunnelOwnershipInvariants.property.test.js SIGKILLs everything the
  predicate returns at module load - before its own first assertion. So a
  sibling suite's LIVE fixtures, held for tens of seconds while that sibling's
  own assertions run, can be killed out from under it by a file that has not
  started testing yet.

  The discriminator owed here is between "left behind by a run that is gone"
  and "in use by a run that is still here". Both shapes sit under the same
  temp directory and both carry the same command-line shape, so the temp path
  cannot tell them apart - it was never the wrong choice for reaching the
  operator's real tunnel, it is simply not a scoping decision at all.

  Background:
    Given the leaked-fixture sweep the tunnel property suites share

  # BL-1287 fixture-sweep-scoping-01
  Scenario Outline: A fixture is swept only when the run that created it is gone
    Given a fixture cloudflared under the OS temp directory bound to its own unique tunnel name
    And the run that created that fixture is <creator>
    When the sweep selects the fixture pids it will signal
    Then that fixture pid is <disposition> the selection

    Examples:
      | creator     | disposition |
      | still alive | absent from |
      | gone        | present in  |

  # BL-1287 fixture-sweep-scoping-02
  # BL-1061's safety property, restated because this ticket changes the
  # selector that carries it: a name-matched sweep would select the operator's
  # real tunnel, which is the hazard the temp-path rule exists to close.
  Scenario: An installed cloudflared outside the temp directory is never selected
    Given a cloudflared running from an installed path outside the OS temp directory
    And it serves the same tunnel name a fixture is using
    When the sweep selects the fixture pids it will signal
    Then that installed process is absent from the selection

  # BL-1287 fixture-sweep-scoping-03
  Scenario: Two suites sweeping in one lane each keep their own fixtures
    Given two property suites running concurrently in the same fork pool
    And each has spawned its own live fixture cloudflared
    When one of those suites runs its leaked-fixture sweep
    Then the other suite's fixture is still alive
