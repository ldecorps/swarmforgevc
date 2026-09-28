Feature: BL-1791 the OpenRouter provider test's fixture names no qwen slug on an OpenRouter role

  swarmforge/scripts/test/test_openrouter_provider_support.sh (BL-523) proves
  that a claude role listed in SWARMFORGE_OPENROUTER_ROLES launches against
  openrouter.ai and an unlisted one keeps first-party auth. Its shared
  fixture conf stages the cleaner on --model qwen/qwen3-32b, and case 03
  lists the cleaner for OpenRouter. Since 4ed88430b2 (2026-09-01) the
  launch-script writer checks extra_cli_targets_qwen_cloud before
  role_uses_openrouter - the BL-1328 precedence the human's BL-1324 ruling
  asked for - so the cleaner's script takes the Token Plan branch and case
  03 fails "cleaner should be OpenRouter". The test was red for 27 days
  before the BL-1708 coder probe saw it (coder note 002206, 2026-09-27),
  because no lane runs the shell manifest (BL-1625). The fixture, not the
  precedence, is what this feature corrects: an OpenRouter-listed role in
  the fixture never carries a slug the qwen-cloud sniff claims, and the
  test is green again. Green runs of other shell tests are QA's e2e steps.

  # BL-1791 fixture-names-no-qwen-slug-01
  Scenario: the fixture conf pairs no qwen model with any role
    When the source of swarmforge/scripts/test/test_openrouter_provider_support.sh is read
    Then no window line of its fixture conf carries a --model qwen slug

  # BL-1791 openrouter-provider-test-is-green-02
  Scenario: the OpenRouter provider test passes on this tree
    When swarmforge/scripts/test/test_openrouter_provider_support.sh runs
    Then it exits 0 and prints ALL PASS
