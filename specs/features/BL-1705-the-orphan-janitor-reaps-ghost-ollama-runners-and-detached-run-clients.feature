# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-24T12:47:35.970076359Z","feature_name":"BL-1705 the orphan janitor reaps ghost ollama runners and detached run clients","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1705-the-orphan-janitor-reaps-ghost-ollama-runners-and-detached-run-clients.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: BL-1705 the orphan janitor reaps ghost ollama runners and detached run clients

  A model runner (llama-server) or an "ollama run" client can outlive
  the server or shell that started it. On 2026-09-23 a detached "ollama
  run" of a 27B model and an 11.6 GB llama-server worker were alive
  outside all swarm bookkeeping, and no janitor names ollama at all. The
  orphan janitor, which already sweeps other leaked ancillaries, now
  classifies ollama processes too: a runner whose parent is no longer a
  live ollama server, and a detached run client older than the grace
  period, are reaped; a runner a live server still owns is never
  touched, however large, and the server itself is left to the stop
  paths.

  # BL-1705 the-orphan-janitor-reaps-ghost-ollama-runners-01
  Scenario Outline: the janitor classifies each ollama process by its parentage and age
    Given a process "<command>" whose parent is <parent> and whose age is <age>
    When the orphan janitor classifies it
    Then it is "<verdict>"

    Examples:
      | command                         | parent                  | age        | verdict |
      | llama-server --model m.gguf     | a live ollama serve     | 3 hours    | kept    |
      | llama-server --model m.gguf     | init                    | 3 hours    | reaped  |
      | ollama runner --model m.gguf    | init                    | 10 minutes | reaped  |
      | ollama run qwen2.5-coder:latest | init                    | 2 hours    | reaped  |
      | ollama run qwen2.5-coder:latest | init                    | 5 minutes  | kept    |
      | ollama run qwen2.5-coder:latest | a live interactive shell | 2 hours   | kept    |
      | ollama serve                    | init                    | 3 hours    | kept    |

  # BL-1705 the-orphan-janitor-reaps-ghost-ollama-runners-02
  Scenario: a janitor sweep terminates a reapable ollama ghost and logs it
    Given a stand-in ghost runner whose parent is init
    And a stand-in runner whose parent is a live stand-in ollama serve
    When the orphan janitor sweep runs
    Then the ghost runner is no longer running and the sweep log names its pid and command
    And the owned runner is still running
