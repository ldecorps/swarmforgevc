# mutation-stamp: sha256=e7b02cade56b23117f4ac1be14b1dec02429598b2762ecf20b7ea5998575ccfc
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T01:31:25.092845232Z","feature_name":"An approval commit names the decider","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1368-an-approval-commit-names-the-decider.feature","background_hash":"66e277810f2a9a97ac72cdf4e802fd2a6246cf3ff4e886b7181e92a3f3c1c248","implementation_hash":"unknown","scenarios":[{"index":0,"name":"every decision verb records the same way","scenario_hash":"1937be24afb360958f1e0dcf71aa7ec641d8f955e6f29e0e26e2699b00c4024a","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-05T01:31:25.092845232Z"}]}
# acceptance-mutation-manifest-end

Feature: An approval commit names the decider

  A human tap on Approve makes the bridge commit the flip with the message
  `Approve <id>: record human_approval` and the body `By coder.` - hardcoded in
  both `bridgeServer.ts` and `telegramFrontDeskBotCore.ts`. The byline is a
  literal, not a lookup, so a decision only a human can make is recorded in
  git as a coder's work.

  Every agent already commits as `t <t@t>`, so authorship proves nothing and
  the role byline is the only attribution a reader has. Making it lie on this
  one class of commit removes the last way to tell a human decision from an
  agent's edit.

  It has already cost. On 2026-09-03 QA read that byline as proof an agent had
  self-flipped an approval, reported it as a legitimacy breach, and the
  coordinator committed that conclusion into the ticket. The approval was
  genuine. Three roles spent a turn each on a false trail laid by a hardcoded
  string.

  Background:
    Given a ticket pending human approval

  # BL-1368 an-approval-commit-names-the-decider-01
  Scenario Outline: every decision verb records the same way
    When the human records a <verb> decision
    Then the commit does not carry a pipeline role byline

    Examples:
      | verb   |
      | Approve |
      | Reject  |
      | Amend   |

  # BL-1368 an-approval-commit-names-the-decider-02
  Scenario: an agent's own commit still carries its role byline
    Given a pipeline role commits its own work
    When the commit is written
    Then the commit carries that role's byline
