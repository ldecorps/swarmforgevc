# mutation-stamp: sha256=caaf9f92e8893107dd557dc86497077239d78f126e7cfc2060c042000f0b37f5
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T20:19:17.513237644Z","feature_name":"BL-1425 A queue-jump places the ticket on the pipeline past the depth cap","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1425-a-queue-jump-places-the-ticket-past-the-depth-cap.feature","background_hash":"2d506d2ae8d2f48988d74d6390da8b7abc799aab66249ff92d30cee2bcff2dd9","implementation_hash":"unknown","scenarios":[{"index":0,"name":"only the depth cap yields to a queue-jump","scenario_hash":"85db312433511bb5ce86757a72cac72a9b03866c1b352174e58fc6a473ab5ccd","mutation_count":20,"result":{"Total":20,"Killed":20,"Survived":0,"Errors":0},"tested_at":"2026-09-05T20:19:17.513237644Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1425 A queue-jump places the ticket on the pipeline past the depth cap

  The Approvals Q jump tap, the /qjump verb and the paused-pager Expedite all
  mean "work this now": approve, promote paused to active, dispatch to the
  coder. BL-1083 routed that promotion through the one promotion-gates
  chokepoint so a tap could no longer walk past depends_on or a hold, and
  asked the human whether the depth cap should stay overridable by an
  explicit tap; the strict reading was approved on 2026-08-23, so today a Q
  jump on a full cap is refused ("active count N >= cap M - no open slot")
  and the ticket stays paused with its approval recorded. Human directive
  2026-09-05, verbatim: "ammend qjump behaviour: it should.place the ticket
  on rails, ignoring the max cap".

  This feature is that a queue-jump crosses exactly one gate, the depth cap,
  as a mode the caller declares to the chokepoint: the ticket lands in
  active and is dispatched, the operator is told the cap was crossed with
  the count and the cap, and everything else is unchanged - depends_on,
  hold and blocked refuse a queue-jump as they refuse any promotion, an
  ordinary promotion on the same full cap is still refused, and the
  coordinator's own promotion path never declares the mode. Every scenario
  runs against a fixture root under a temporary directory, never the live
  checkout.

  Background:
    Given a fixture root whose backlog/active already holds as many tickets as active_backlog_max_depth allows

  # BL-1425 only-the-depth-cap-yields-to-a-queue-jump-01
  Scenario Outline: only the depth cap yields to a queue-jump
    Given a candidate that is <ticket>
    When the candidate is promoted <mode>
    Then the candidate ends up in <folder>
    And the verdict <verdict>

    Examples:
      | ticket                                          | mode                 | folder | verdict                                                             |
      | a paused ticket only the full depth cap refuses | as a queue-jump      | active | says the depth cap was crossed, naming the active count and the cap |
      | a paused ticket only the full depth cap refuses | without a queue-jump | paused | names the active_backlog_max_depth gate as refusing                 |
      | a paused ticket refused for depends_on          | as a queue-jump      | paused | names the depends_on gate as refusing                               |
      | a held ticket                                   | as a queue-jump      | hold   | names the hold gate as refusing                                     |
      | a paused ticket with status blocked             | as a queue-jump      | paused | names the blocked gate as refusing                                  |

  # BL-1425 the-operator-is-told-the-cap-was-crossed-02
  Scenario: the Approvals topic is told a Q jump crossed the cap
    Given the queue-jump promotion of BL-9001 reported the depth cap crossed
    When the Q jump tap for BL-9001 is delivered
    Then the Approvals topic is told the cap was crossed, naming the active count and the cap
    And the ask closes with the Q jumped decision line as today

  # BL-1425 the-coordinators-own-path-never-queue-jumps-03
  Scenario: the coordinator's own promotion path never declares a queue-jump
    When the promotion scripts the coordinator and the daemon run are read
    Then none of them invokes the chokepoint in queue-jump mode
