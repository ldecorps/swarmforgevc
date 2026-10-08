Feature: The tool-call shim names the seat behind every chat completion
  Every local-model seat on the host reaches Ollama through one tool-call
  shim (BL-1917, port 11439), and Ollama serves one completion at a time
  from one cache. The shim cannot tell one seat's request from another's,
  so nothing measures what a seat switch costs - on iq3 a full re-prefill,
  23-38 s at 20-30k tokens - and nothing can share decode by seat. Each
  seat now reaches the shim at a URL that names it, and the shim logs every
  chat completion with its seat. First slice of the full-forge decode slot
  (intake INTAKE-full-forge-iq3-one-gpu-decode-slot-20261007); BL-2077
  builds the slot on it.

  Background:
    Given a tool-call shim in front of a fake Ollama

  # BL-2076 completion-names-its-seat-01
  Scenario Outline: a completion sent at a seat's URL reaches Ollama unchanged and is logged with that seat
    When seat "<seat>" sends a chat completion to the URL swarmforge.sh works out for it
    Then the fake Ollama receives it at /v1/chat/completions with the same body
    And the shim log line for that completion names seat "<seat>" with its duration and prompt tokens

    Examples:
      | seat    |
      | coder   |
      | coder@2 |

  # BL-2076 switch-is-logged-02
  Scenario: a completion from a different seat than the one before it is logged as a switch
    When seat "coder" sends two chat completions and then seat "QA" sends one
    Then the log line for coder's second completion reads switch=0
    And the log line for QA's completion reads switch=1

  # BL-2076 plain-path-still-served-03
  Scenario: a completion at the plain /v1 path is still served and is logged with no seat
    When a client sends a chat completion at the shim's plain /v1 path
    Then the fake Ollama receives it at /v1/chat/completions with the same body
    And the shim log line for that completion names seat "-" with its duration and prompt tokens
