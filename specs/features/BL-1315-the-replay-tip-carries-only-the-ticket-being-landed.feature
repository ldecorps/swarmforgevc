# mutation-stamp: sha256=18b3bde80b6e34aaeb51b539ee43710ae0849c62c5c15a56e5999f124dd369b5
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-31T21:19:05.592216741Z","feature_name":"A replay tip adds only the content of the ticket being landed","feature_path":"/home/carillon/swarmforgevc/.worktrees/expedite-BL-1315/specs/features/BL-1315-the-replay-tip-carries-only-the-ticket-being-landed.feature","background_hash":"f74d022fcdd1520590182162d0e26993aef43ca97300ff7a23fb09aa5d73eff6","implementation_hash":"unknown","scenarios":[{"index":1,"name":"A sibling that contributes no novel content is not subtracted","scenario_hash":"959c8574bc2c7b8e7d99e059ab6fa884200ac99887cdf73c816fb73165fbcfab","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-31T21:19:05.592216741Z"}]}
# acceptance-mutation-manifest-end

Feature: A replay tip adds only the content of the ticket being landed

  land_step_lib.bb's own-paths delegates to task_scope_gate_lib.bb's
  task-tagged-changed-paths, which filters candidates to commits whose subject
  names the ticket and then expands each one with own-commit-changed-paths
  :delivered. For a merge, :delivered is a real two-tree diff against the FIRST
  parent - so it returns everything the second parent brought in, whoever
  authored it and whatever ticket it belongs to.

  A role's forward-merge takes its subject from the ticket it forwards. An
  earlier, still-unlanded ticket whose work rode along on that branch is
  therefore swept into the replay tip under the forwarded ticket's name.

  BL-1308 widened the sibling DETECTOR to see this, and said so in its own
  comment: "the detector under-included in exactly the place the path set
  over-includes. Only DETECTION widens here." So the tip is now correctly
  NAMED as entangled - and is still built carrying content it should not.
  Twice in two days a verified-green parcel was held rather than landed:
  BL-1307 over BL-1300 on 2026-08-30, BL-1298 over BL-1303 on 2026-08-31.

  The same computation loses the ticket's OWN content, for the same reason.
  :delivered answers "what did this merge bring in relative to its FIRST
  parent"; the replay needs "what does this ticket's chain contribute relative
  to origin/main". When the ticket's own work reached the branch BEFORE its own
  tagged merge - which is what a sibling's passenger ride does to it - the
  first-parent diff no longer holds it and the replay drops it. On 2026-08-31
  the one event, QA's merge 86c2ed1c2d, caused both holds at once: BL-1298's
  replay over-included BL-1303's files and BL-1303's replay under-included the
  same ones. Subtraction alone cannot fix the second face - a path that was
  never in the set cannot be subtracted back into it.

  Background:
    Given a QA tip whose ticket-tagged merge imports a role branch
    And the sibling detector reports every ticket that branch carries

  # BL-1315 replay-tip-carries-only-the-landed-ticket-01
  Scenario: A sibling's unlanded content does not enter the replay tip
    Given the imported branch carries, besides the landed ticket, a sibling that is "unlanded"
    When the replay builds its tip
    Then the tip adds no path attributable only to the sibling
    And the tip still adds every path the landed ticket's own chain delivered

  # BL-1315 replay-tip-carries-only-the-landed-ticket-02
  Scenario Outline: A sibling that contributes no novel content is not subtracted
    Given the imported branch carries, besides the landed ticket, a sibling that is "<sibling>"
    When the replay builds its tip
    Then the tip is unchanged from the full delivered set

    Examples:
      | sibling                                  |
      | already landed on origin/main            |
      | byte-identical to what origin/main holds |

  # BL-1315 replay-tip-carries-only-the-landed-ticket-03
  Scenario: Every role's contribution to the landed ticket survives
    Given the landed ticket chain delivered content authored by "coder" and by "hardender"
    And only the documenter's forward-merge names the ticket in its subject
    When the replay builds its tip
    Then the tip adds the paths delivered by "coder"
    And the tip adds the paths delivered by "hardender"

  # BL-1315 replay-tip-carries-only-the-landed-ticket-04
  Scenario: An undeterminable attribution refuses rather than narrows
    Given a path on the tip whose attributing ticket cannot be read
    When the replay builds its tip
    Then the replay refuses
    And the refusal names that path
    And no tip is advised for push

  # BL-1315 replay-tip-carries-only-the-landed-ticket-05
  Scenario: A tip with no entangled sibling is untouched
    Given the imported branch carries content of no other ticket
    When the replay builds its tip
    Then the tip is unchanged from the full delivered set

  # BL-1315 replay-tip-carries-only-the-landed-ticket-06
  Scenario: Content that reached the branch before the ticket's own merge still lands
    Given the landed ticket's content reached the branch on an earlier sibling's merge
    And the ticket's own ticket-tagged merge therefore adds none of it
    When the replay builds its tip
    Then the tip still adds every path the landed ticket's own chain delivered
    And the tip is not limited to what the ticket-tagged merge added over its first parent
