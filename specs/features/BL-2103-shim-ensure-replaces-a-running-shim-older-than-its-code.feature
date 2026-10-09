Feature: BL-2103 Shim ensure replaces a running shim older than its code

  Every local-model seat's launch script runs `local_model_tool_call_shim.py
  ensure` before qwen starts. ensure reuses any process whose
  `GET /shim/health` names the shim and the upstream, whatever code that
  process runs. On 2026-10-09 a shim started the evening before BL-2076
  stayed up across a relaunch; the relaunched coder seat called its new
  `/seat/coder/v1` route, the old shim forwarded that path to Ollama, and
  every wake failed "404 page not found" until QA killed the shim by hand.
  This feature is that ensure reuses only a shim running the code on disk,
  replaces one running other code, and still never touches a process that
  is not the shim.

  Background:
    Given a fake Ollama upstream

  # BL-2103 shim-ensure-replaces-stale-shim-01
  Scenario: a shim running the code on disk is reused
    Given the shim from disk is serving on the port
    When ensure runs for that port and upstream
    Then ensure exits 0
    And the first process still serves the port

  # BL-2103 shim-ensure-replaces-stale-shim-02
  Scenario Outline: a shim running other code is replaced by one running the code on disk
    Given <stale shim> is serving on the port
    When ensure runs for that port and upstream
    Then ensure exits 0
    And the first process has exited
    And the process serving the port reports the code on disk

    Examples:
      | stale shim                                                         |
      | a copy of the shim with one line changed                           |
      | a stand-in that answers the shim's health without a code fingerprint |

  # BL-2103 shim-ensure-replaces-stale-shim-03
  Scenario: a port held by something that is not the shim is left alone
    Given a process that is not the shim is serving on the port
    When ensure runs for that port and upstream
    Then ensure exits 1
    And the first process still serves the port
