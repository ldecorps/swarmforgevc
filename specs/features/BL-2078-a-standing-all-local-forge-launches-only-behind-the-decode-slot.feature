Feature: A standing all-local forge launches only behind the decode slot
  BL-1142 kept local Ollama packs on mono-router because standing local
  seats would wedge Ollama. With the shim's decode slot (BL-2077), standing
  seats run shell, tests and git at the same time while the model serves
  one seat at a time. On the mono pack on 2026-10-07/08 the GPU was busy
  43-79% of each active hour, about half on the median hour: idle while
  the one resident ran tools or waited. A standing all-local pack, the
  live mono pack's seven local seats plus its Claude coordinator, now
  launches through the local pack-shape gate, which allows it only while
  the seats reach Ollama through the shim. Mono-router stays the default
  for router packs.

  Background:
    Given the ollama-ista-local-model-claude-coord-forge pack

  # BL-2078 gate-allows-forge-behind-slot-01
  Scenario Outline: the local pack-shape gate allows the standing forge pack only behind the decode slot
    When the local pack-shape gate evaluates it with the tool-call shim <shim>
    Then staffing is <verdict>

    Examples:
      | shim | verdict                                  |
      | on   | allowed                                  |
      | off  | refused naming the missing decode slot   |

  # BL-2078 forge-pack-one-model-load-02
  Scenario: the standing forge pack serves every local seat from one model load
    When the pack conf is read
    Then it declares no rotation router and no single_inference_slot
    And every local-model window names the same model tag
    And its active_backlog_max_depth is a positive number no higher than 5
