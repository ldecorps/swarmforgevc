# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-10-03T06:59:46.558551320Z","feature_name":"BL-1848 A local model's served window is watched against its work and the GPU","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1848-a-local-models-served-window-is-watched-against-its-work-and-the-gpu.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":3,"name":"no window finding when there is nothing to judge","scenario_hash":"c8394c6cc96e67ce6e38f3111417c224bc799fb580ef68583982198698819fac","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-10-03T06:59:46.558551320Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1848 A local model's served window is watched against its work and the GPU

  The coder@iq3 seat is served by Ollama with a 49152-token window. That
  window has two limits. Too small, and a request runs into it: qwen
  compresses or gives up. Too large, and the model no longer fits in the
  GPU's memory: Ollama puts part of it on the CPU and the seat slows about
  seven times. Until now both were found by hand reads after the fact. The
  babysitter sweep now checks both on every tick, for every model Ollama
  has loaded, and raises a CRIT naming the model and the numbers, so the
  coordinator and the operator hear about it the same way as any other
  swarm health fault.

  # BL-1848 a-request-near-the-served-window-reads-as-too-small-01
  Scenario Outline: the largest recent request is compared with the served window
    Given Ollama has "ista-iq3s-coder:latest" loaded with 13818 MiB of its 13818 MiB in VRAM and a 49152-token context
    And qwen recorded a request of <tokens> tokens for "<recorded model>" <minutes> minutes ago
    When the local window check runs
    Then the window check reports "<outcome>"

    Examples:
      | tokens | recorded model         | minutes | outcome          |
      | 44236  | ista-iq3s-coder:latest | 10      | no finding       |
      | 44237  | ista-iq3s-coder:latest | 10      | window too small |
      | 47000  | ista-iq3s-coder:latest | 61      | no finding       |
      | 47000  | other-model:latest     | 10      | no finding       |

  # BL-1848 a-model-partly-outside-vram-reads-as-outgrowing-the-gpu-02
  Scenario: a model partly outside VRAM is reported as outgrowing GPU memory
    Given Ollama has "ista-iq3s-coder:latest" loaded with 12400 MiB of its 13818 MiB in VRAM and a 49152-token context
    When the local window check runs
    Then the window check reports "window outgrew GPU memory"
    And the finding is a CRIT keyed "local-window-vram-ista-iq3s-coder:latest"
    And its message names 12400 of 13818 MiB in VRAM and the 49152 context

  # BL-1848 the-too-small-finding-names-the-peak-and-its-split-03
  Scenario: the too-small finding names the model, the peak and what filled it
    Given Ollama has "ista-iq3s-coder:latest" loaded with 13818 MiB of its 13818 MiB in VRAM and a 49152-token context
    And qwen recorded a request of 30800 input and 14100 output tokens for "ista-iq3s-coder:latest" 10 minutes ago
    When the local window check runs
    Then the finding is a CRIT keyed "local-window-size-ista-iq3s-coder:latest"
    And its message names the 44900-token peak, 30800 in and 14100 out, and the 49152 context

  # BL-1848 an-unreadable-source-raises-nothing-04
  Scenario Outline: no window finding when there is nothing to judge
    Given Ollama is <ollama state>
    When the local window check runs
    Then the window check reports "no finding"

    Examples:
      | ollama state                        |
      | not answering                       |
      | answering with no model loaded      |

  # BL-1848 the-babysitter-sweep-carries-the-window-finding-05
  Scenario: the babysitter sweep carries the window finding with its other findings
    Given Ollama has "ista-iq3s-coder:latest" loaded with 12400 MiB of its 13818 MiB in VRAM and a 49152-token context
    When the babysitter sweep assembles its findings from that snapshot
    Then the sweep's findings include a CRIT keyed "local-window-vram-ista-iq3s-coder:latest"
