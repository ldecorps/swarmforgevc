Feature: BL-1328 Qwen-cloud --model detection covers the equals-sign form; OpenRouter/qwen precedence documented

  BL-1324 certified hotfix 4ed88430b2's `extra_cli_targets_qwen_cloud`
  matcher, which only recognizes a separate `--model qwen*` token pair —
  the `--model=qwen*` single-token form silently fails to match, and every
  current pack window line happens to use the space form so this is
  dormant, not live. Separately, the fix's two call sites in
  swarmforge.sh disagree on precedence between OpenRouter routing and
  qwen-cloud targeting: the billing_guard construction site (around
  extra_cli_targets_qwen_cloud's first call) checks qwen-cloud before
  role_uses_openrouter, while launch_role's pane-env construction site
  checks role_uses_openrouter first, so a role combining both would take
  different branches at the two sites. No live pack combines them today.
  This is the narrow follow-up the human's BL-1324 ruling authorized:
  close the equals-form detection gap, and document (not reconcile) the
  precedence asymmetry at both sites.

  Background:
    Given the swarmforge.sh launch pipeline's qwen-cloud detection helper

  # BL-1328 model-token-form-detection-01
  Scenario Outline: qwen-cloud detection covers both --model token forms and rejects non-qwen models
    Given a role's extra CLI args contain "<cli_args>"
    When extra_cli_targets_qwen_cloud evaluates those args
    Then it <outcome> a qwen-cloud target

    Examples:
      | cli_args                     | outcome         |
      | --model=qwen3.8-max          | reports         |
      | --model qwen3.8-max          | reports         |
      | --model=claude-sonnet-5      | does not report |

  # BL-1328 precedence-asymmetry-documented-02
  Scenario: the OpenRouter/qwen precedence asymmetry is documented at both call sites
    Given the billing_guard construction site prefers qwen-cloud over OpenRouter
    And the launch_role pane-env construction site prefers OpenRouter over qwen-cloud
    When the swarmforge.sh source is inspected
    Then both sites carry an explicit comment naming the asymmetry and that no live pack combines the two today
