# mutation-stamp: sha256=d04f0e8f6a093c3d99e5b3b310c0d3ee53561df0c75f5fbe848fdf0f039bce23
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-10-01T11:55:16.847057332Z","feature_name":"BL-1840 A local-model seat is never served a window in qwen's compaction dead zone","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1840-a-local-model-seats-qwen-compresses-only-when-the-history-nears-the-served-window.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the window gate judges a served window by the trigger qwen computes for it","scenario_hash":"ed19ed4defa7c1bddb720e58c0ee8124f97ed5e842ed2029b6d3ccb22802c85c","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-10-01T11:55:16.847057332Z"},{"index":2,"name":"the trigger the gate reports is the one the pinned qwen computes","scenario_hash":"43db3c55a28d3f47330e0a86e081f6bfb389ab11bc0219dbb3a1576513bd580f","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-10-01T11:55:16.847057332Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1840 A local-model seat is never served a window in qwen's compaction dead zone

  qwen summarises its own chat history once the history passes a trigger it
  computes from the window it is told: 85% of the window, but never more
  than the window less 33,000 tokens (20,000 kept for the summary and a
  13,000 buffer, both fixed inside qwen, with no setting or environment
  variable to change them). Below 33,000 tokens only the 85% applies. So a
  32768-token window compacts at 27,852 tokens, while a 49152-token window
  compacts at 16,152. On 2026-09-30 the coder@iq3 seat, served 49152,
  compacted at about 17,500 tokens three times in ten minutes, each time
  saving about 80 tokens in a five-minute reply. The autoCompactThreshold
  setting cannot move the trigger in that range. Every window from 33,001
  to 60,852 tokens compacts sooner than 32768 does while costing more
  memory. The launch's window gate now computes qwen's trigger for each
  local-model seat's served window and flags a window in that range.

  # BL-1840 the-window-gate-reports-qwens-compaction-trigger-01
  Scenario Outline: the window gate judges a served window by the trigger qwen computes for it
    Given a local-model seat whose model Ollama serves with num_ctx <served>
    When the launch's window gate checks the seat
    Then the gate reports a compaction trigger of <trigger> tokens
    And the gate <verdict> the window as in qwen's compaction dead zone

    Examples:
      | served | trigger | verdict      |
      | 32768  | 27852   | does not flag |
      | 49152  | 16152   | flags        |
      | 60852  | 27852   | does not flag |
      | 65536  | 32536   | does not flag |

  # BL-1840 a-dead-zone-window-is-named-with-the-windows-that-avoid-it-02
  Scenario: a dead-zone window is refused, naming its trigger and the windows that avoid it
    Given a local-model seat whose model Ollama serves with num_ctx 49152
    When the launch's window gate checks the seat
    Then the launch is refused
    And the refusal names the window 49152, the trigger 16152, and the windows 32768 and 60852

  # BL-1840 the-trigger-matches-what-qwen-itself-computes-03
  Scenario Outline: the trigger the gate reports is the one the pinned qwen computes
    Given the pinned qwen running against a loopback fake endpoint that serves num_ctx <served>
    When qwen logs its compaction check for a short history
    Then qwen's own logged trigger is <trigger> tokens

    Examples:
      | served | trigger |
      | 32768  | 27852   |
      | 49152  | 16152   |
