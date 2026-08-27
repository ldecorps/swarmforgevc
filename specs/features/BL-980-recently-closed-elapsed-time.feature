# mutation-stamp: sha256=99c32987bbf649314d3edc9236b6c408dc10435b8f98d4d71d2476435397f8ac
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-27T06:12:03.858358278Z","feature_name":"BL-980 each RECENTLY CLOSED line shows how long ago the ticket closed","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-980-recently-closed-elapsed-time.feature","background_hash":"1b0a6c81fdcc3416bf0397c9b06b322417b8576a05841bf1b4c581363f5c0fc1","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the relative-age ladder","scenario_hash":"a2fd6f2d7981fd3dfb6b3e012bb390ff19d7d29b79bed2427b94e3f533e57737","mutation_count":14,"result":{"Total":14,"Killed":14,"Survived":0,"Errors":0},"tested_at":"2026-08-27T06:12:03.858358278Z"},{"index":3,"name":"only RECENTLY CLOSED lines gain the suffix","scenario_hash":"80546745b6f2c5ace762ae0cf8b28a23300c9e60f20bc1c7833ac142c6aa907b","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-27T06:07:50.867759087Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-980 each RECENTLY CLOSED line shows how long ago the ticket closed

  The board's RECENTLY CLOSED section lists id + slug with no sense of when
  anything closed, so a ticket closed ten minutes ago and one closed yesterday
  read identically on a phone. conciergeTick.ts already keeps a durable,
  monotonic per-ticket closure instant (TickState.doneClosedAtMs, stamped once
  and never restamped) and already SORTS the section by it - it is simply not
  carried through to the rendered line. Human addendum, 2026-08-20.

  Background:
    Given a pipeline board whose RECENTLY CLOSED section lists closed tickets

  # BL-980 recently-closed-elapsed-time-01
  Scenario Outline: the relative-age ladder
    Given a ticket closed <elapsed_ms> ms before the render instant
    When the RECENTLY CLOSED section renders
    Then its line ends with "(<age>)"

    Examples:
      | elapsed_ms | age        |
      | 59999      | just now   |
      | 60000      | 1min ago   |
      | 3599999    | 59min ago  |
      | 3600000    | 1h ago     |
      | 86399999   | 23h ago    |
      | 86400000   | 1d ago     |
      | 604800000  | 7d ago     |

  # BL-980 recently-closed-elapsed-time-02
  Scenario: an unknown closure instant produces no age at all
    Given a closed ticket with no recorded closure instant
    When the RECENTLY CLOSED section renders
    Then its line carries no parenthetical age

  # BL-980 recently-closed-elapsed-time-03
  Scenario: the age comes from the durable closure record, not the file
    Given a ticket whose recorded closure instant is 2 hours before the render instant
    And whose backlog file was rewritten one minute before the render instant
    When the RECENTLY CLOSED section renders
    Then its line ends with "(2h ago)"

  # BL-980 recently-closed-elapsed-time-04
  Scenario Outline: only RECENTLY CLOSED lines gain the suffix
    Given the board renders its "<section>" section
    When the board body renders
    Then no line in that section carries a parenthetical age

    Examples:
      | section          |
      | PARKED           |
      | AWAITING APPROVAL|
      | ROOT INTAKE      |
      | grid captions    |
