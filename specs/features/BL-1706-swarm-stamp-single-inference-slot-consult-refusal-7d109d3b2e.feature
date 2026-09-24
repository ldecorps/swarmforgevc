Feature: BL-1706 swarm stamp - the single-inference-slot consult refusal (hotfix 7d109d3b2e)

  Review-only certification (BL-848) of an operator hotfix already live on
  main. The mono-router consult spawn (hotfix 5bdf93beed, stamped by
  BL-1549) starts a stuck role's own session while the resident is
  mid-turn. On a pack whose model backend serves one request at a time,
  that second session is guaranteed to contend for the one inference slot
  the resident holds; on 2026-09-23 the coordinator and a QA consult
  session both sat retrying timeouts against the local endpoint while the
  coder idled. The hotfix makes consult-eligible? refuse outright when the
  pack declares `config single_inference_slot 1`, and leaves every other
  pack's behaviour unchanged. These scenarios confirm what landed; they
  change nothing in it.

  # BL-1706 swarm-stamp-single-inference-slot-consult-refusal-01
  Scenario Outline: consult eligibility follows the single-inference-slot flag when every other check passes
    Given a departing-mid-parcel refusal for a distinct target role with no consult session active
    When consult eligibility is decided with the single-inference-slot flag <flag>
    Then the consult spawn is "<decision>"

    Examples:
      | flag   | decision |
      | true   | refused  |
      | false  | eligible |
      | absent | eligible |

  # BL-1706 swarm-stamp-single-inference-slot-consult-refusal-02
  Scenario Outline: the pack conf's single_inference_slot line is read strictly
    Given a pack conf whose single-inference-slot line is <line>
    When the conf text is parsed for the single-inference-slot flag
    Then the flag reads "<value>"

    Examples:
      | line                                   | value |
      | config single_inference_slot 1         | true  |
      | config single_inference_slot 0         | false |
      | # config single_inference_slot 1       | false |
      | missing                                | false |

  # BL-1706 swarm-stamp-single-inference-slot-consult-refusal-03
  Scenario: the daemon's consult spawn starts no session on a single-inference-slot pack
    Given the effective pack conf declares config single_inference_slot 1
    And a departing-mid-parcel refusal for a distinct target role with no consult session active
    When the daemon's consult spawn runs for that refusal
    Then no tmux session was created and no consult marker was written
