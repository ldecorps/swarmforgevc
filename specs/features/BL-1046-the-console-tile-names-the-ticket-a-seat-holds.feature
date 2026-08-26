# mutation-stamp: sha256=979d1e33f0206bd893aeac117258431c343781b3a4507a79c873b621f72fd59e
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-26T11:35:00.611185618Z","feature_name":"The fleet console's role tiles name the ticket each seat holds and how long it has held it","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1046-the-console-tile-names-the-ticket-a-seat-holds.feature","background_hash":"b86124456fadd68619ad368e96af50f6eb0960cf2170f3915ffd4c12c51ad332","implementation_hash":"unknown","scenarios":[{"index":1,"name":"The claim age is shown for every role, not only the coder and resident seats","scenario_hash":"f9b1ba261d1849b591445685a8932172c75ea9448ec1604a1460c5977020a730","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-26T11:35:00.611185618Z"}]}
# acceptance-mutation-manifest-end

Feature: The fleet console's role tiles name the ticket each seat holds and how long it has held it

  The live console's role grid (the eight tiles at e.musicalsifu.com) renders
  the role name and an Expand button and nothing else, so a glance across the
  grid says who the seats ARE and never what they are DOING. The held ticket,
  its slug, and the claim age are already on the pane payload — the fullscreen
  Expand view renders all three — and only the grid tile drops them.

  This slice surfaces the HELD form on the grid tile. The not-held ("last
  ticket this seat acted on", read from its own completed/ mailbox) form is
  deliberately NOT part of this slice: it belongs to BL-1044, which owns that
  derivation for the terminal title bars and has not been built yet. An idle
  tile here therefore names no held ticket, and a later slice may add a past
  form alongside without contradicting anything asserted below.

  Background:
    Given the live console is authenticated and showing the role grid
    And the pane payload resolves each seat's held ticket from that seat's own in_process mailbox

  # BL-1046 console-tile-holds-ticket-01
  Scenario: A seat holding a parcel names the ticket and the claim age on its grid tile
    Given the "hardender" seat holds ticket "BL-1035" titled "a respawned front desk bot is declared stalled two seconds after it starts"
    And that seat entered the claim "32" minutes ago
    When the role grid renders
    Then the "hardender" tile shows the ticket id "BL-1035"
    And the "hardender" tile shows a slug derived from the ticket title
    And the "hardender" tile shows a claim age of "32" minutes
    And the "hardender" tile shows the role name

  # BL-1046 console-tile-holds-ticket-02
  Scenario Outline: The claim age is shown for every role, not only the coder and resident seats
    Given the "<role>" seat holds ticket "BL-1041" and entered the claim "5" minutes ago
    When the role grid renders
    Then the "<role>" tile shows a claim age of "5" minutes

    Examples:
      | role        |
      | coordinator |
      | specifier   |
      | cleaner     |
      | qa          |

  # BL-1046 console-tile-holds-ticket-03
  Scenario: A batch seat holding several parcels names the oldest claim and counts the rest
    Given the "cleaner" seat holds tickets "BL-1010", "BL-1011" and "BL-1014"
    And the oldest of those claims is "BL-1010"
    When the role grid renders
    Then the "cleaner" tile shows the ticket id "BL-1010"
    And the "cleaner" tile shows that "2" further parcels are held

  # BL-1046 console-tile-holds-ticket-04
  Scenario: A seat holding nothing names no held ticket and stays tappable
    Given the "documenter" seat holds no parcel
    When the role grid renders
    Then the "documenter" tile shows no held ticket
    And the "documenter" tile shows the role name
    And the "documenter" tile can still be expanded

  # BL-1046 console-tile-holds-ticket-05
  Scenario: An unreachable pane says so rather than showing a stale ticket
    Given the "architect" pane is not reachable
    When the role grid renders
    Then the "architect" tile shows the role name
    And the "architect" tile shows no held ticket

  # BL-1046 console-tile-holds-ticket-06
  Scenario: The grid and the fullscreen view never disagree about who holds what
    Given the "qa" seat holds ticket "BL-1011"
    When the role grid renders
    And the "qa" tile is expanded
    Then the ticket id shown on the grid tile and in the fullscreen view are the same

  # BL-1046 console-tile-holds-ticket-07
  Scenario: The ticket id on a holding tile uses a smaller type size than the role name
    Given the "hardender" seat holds ticket "BL-1035"
    When the role grid renders
    Then the "hardender" tile shows the ticket id "BL-1035"
    And the ticket id's rendered font size is smaller than the role name's font size

  # BL-1046 console-tile-holds-ticket-08
  Scenario: A phone-width mock of the eight-tile grid is delivered to the operator email before UI approval is treated as done
    Given the role grid can render holding seats with ticket ids
    When the UI approval package for this slice is prepared
    Then a phone-width mock of the eight-tile grid with sample ticket ids on holding seats is generated
    And that mock is delivered to the configured operator email inbox (or linked from the Approvals ask)
    And evidence of the mock is recorded under backlog/evidence/
