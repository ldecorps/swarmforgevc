Feature: BL-2106 The steward probes a local coder through a prepared alias

  A bare Hugging Face GGUF tag probed as-is reads as a useless model: on
  2026-10-09 two candidates handed off 0 of 5 BL-1700 scenarios, every
  coder fixture ending "no model commit" in under 60 s, because the live
  iq3 seats run behind a Modelfile (num_ctx, num_predict) with thinking
  off and the bare tags had neither. The shared prepare path
  (local_model_prepare_lib.bb, landed by a Cursor agent in 1e64496d93)
  renders a Modelfile from a frozen template, creates an Ollama alias from
  it and writes a think-off profile; `model_steward_cli.bb probe --prepare`
  probes that alias. Preparing proposes an alias and evidence only: it
  never touches a pack, a launch script or a day-shift default.

  Background:
    Given an empty steward state directory
    And a fake ollama on the PATH that records every call

  # BL-2106 steward-prepared-alias-01
  Scenario Outline: prepare renders the frozen template at the sizes asked for
    When the steward prepares "hf.co/org/repo:TAG" with "<size flags>"
    Then the prepared Modelfile's FROM line names "hf.co/org/repo:TAG"
    And the prepared Modelfile sets num_ctx <num_ctx> and num_predict <num_predict>
    And the fake ollama was asked to create the prepared alias from that Modelfile

    Examples:
      | size flags                          | num_ctx | num_predict |
      | no size flags                       | 32768   | 4096        |
      | --num-ctx 65536 --num-predict 2048  | 65536   | 2048        |

  # BL-2106 steward-prepared-alias-02
  Scenario: a dry run writes the files and creates no Ollama model
    When the steward prepares "hf.co/org/repo:TAG" with "--dry-run"
    Then the prepared Modelfile's FROM line names "hf.co/org/repo:TAG"
    And the think-off profile sets think false for every id the prepared alias is called by
    And the fake ollama was never called

  # BL-2106 steward-prepared-alias-03
  Scenario Outline: only the empty-implement fail shape earns a prepared re-probe
    When a probe summary of <summary> is judged
    Then the steward <decision>

    Examples:
      | summary                                                         | decision                       |
      | 0 of 5 handed off, every coder fixture no model commit in 12 s  | re-probes once through prepare |
      | 0 of 5 handed off, one coder fixture no model commit in 90 s    | does not re-probe              |
      | 2 of 5 handed off                                               | does not re-probe              |

  # BL-2106 steward-prepared-alias-04
  Scenario: preparing never touches a pack, a launch script or a day-shift default
    When the steward prepares "hf.co/org/repo:TAG" with "no size flags"
    Then no file under swarmforge/packs, .swarmforge/launch or the day-shift config changed
