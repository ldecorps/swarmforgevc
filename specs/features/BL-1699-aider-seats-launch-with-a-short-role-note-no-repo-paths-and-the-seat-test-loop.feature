# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-25T19:25:48.948501858Z","feature_name":"BL-1699 aider seats launch with a short role note, no repo paths and the seat test loop","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1699-aider-seats-launch-with-a-short-role-note-no-repo-paths-and-the-seat-test-loop.feature","background_hash":"f2ded7f33a71ada4b171f5547fd7e1adc14314a3e5bfe9290b061bef63403fd7","implementation_hash":"unknown","scenarios":[{"index":2,"name":"only a coder aider seat runs aider's test loop through the seat test verb","scenario_hash":"ba59dbba3e0aa7c369484affc7b6c639c2cb23ec1b9c20858f31eb170342d64e","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-25T19:25:48.948501858Z"},{"index":3,"name":"the pack's aider timeout reaches the launch line only when it is declared","scenario_hash":"f264deabe908247d6af963ea7db75346699c1bec90b2144d9bf09b1145911a69","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-25T19:25:48.948501858Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1699 aider seats launch with a short role note, no repo paths and the seat test loop

  aider auto-adds every repo path a message mentions, so today's
  bootstrap, which names ready_for_next.sh and the handoff draft, puts a
  pipeline script into every aider seat's chat as an editable file with
  auto-commit on; lab S1 watched a 7B model rewrite one. The seat also
  gets the whole constitution, pipeline and role prompt added, about 18k
  tokens that Ollama silently dropped at an 8k window. An aider seat now
  starts with a short role note loaded read-only, a bootstrap text that
  names no path and no script, and - for a coder seat - aider's own test
  loop running the seat test verb. Claude seats are unchanged.

  Background:
    Given a pack whose coder, QA and coordinator seats run aider and whose specifier seat runs Claude

  # BL-1699 aider-seats-launch-with-a-short-role-note-01
  Scenario Outline: an aider seat's bootstrap text names no repo path, no pipeline script and no bang command
    When the bootstrap text for the "<role>" seat is composed
    Then it contains no path under the repository, no pipeline script name and no line telling the model to reply with "!"

    Examples:
      | role        |
      | coder       |
      | QA          |
      | coordinator |

  # BL-1699 aider-seats-launch-with-a-short-role-note-02
  Scenario: an aider seat's chat starts with its role note read-only and no prompt files added
    When the "coder" seat's launch line and bootstrap steps are generated
    Then the launch line loads the coder's aider role note with --read
    And no bootstrap step adds the constitution, the pipeline or a role prompt file to the chat

  # BL-1699 aider-seats-launch-with-a-short-role-note-03
  Scenario Outline: only a coder aider seat runs aider's test loop through the seat test verb
    When the "<role>" seat's launch line is generated
    Then the launch line <has> a --test-cmd that runs the seat test verb and --auto-test

    Examples:
      | role  | has          |
      | coder | carries      |
      | QA    | carries no   |

  # BL-1699 aider-seats-launch-with-a-short-role-note-04
  Scenario Outline: the pack's aider timeout reaches the launch line only when it is declared
    Given the pack <declares>
    When the "coder" seat's launch line is generated
    Then the launch line carries <timeout>

    Examples:
      | declares                              | timeout            |
      | declares an aider timeout of 1800 s   | --timeout 1800     |
      | declares no aider timeout             | no --timeout flag  |

  # BL-1699 aider-seats-launch-with-a-short-role-note-05
  Scenario: the seat test verb finds the parcel's ticket when aider's test loop runs it
    Given the driver's record for the coder names ticket BL-9 and its acceptance feature
    When the seat test verb runs with no ticket in its environment
    Then the pack's seat test command runs with BL-9 and that acceptance feature in its environment

  # BL-1699 aider-seats-launch-with-a-short-role-note-06
  Scenario: a Claude seat's launch line and bootstrap are unchanged
    When the "specifier" seat's launch line and bootstrap steps are generated
    Then both are byte-identical to what the same pack produced before this ticket
