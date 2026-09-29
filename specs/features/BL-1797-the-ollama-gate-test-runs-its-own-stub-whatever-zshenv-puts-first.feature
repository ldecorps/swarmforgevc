Feature: BL-1797 The ollama gate test runs its own stub whatever zshenv puts first

  test_ollama_ancillary_launch_gate.sh stubs ollama by prepending its
  fixture bin directory to PATH, then drives the launch path through
  zsh -c. zsh sources the user's .zshenv for every zsh -c, and this
  host's .zshenv prepends ~/.local/bin, where a real ollama has lived
  since 2026-09-28 19:26. So the real binary ran instead of the stub,
  failed to bind 127.0.0.1:11434 beside the live server, and scenario 01
  failed with "never answered within 5s". Host load was not the cause.
  Scenario 02's "the stub never ran" check passed vacuously for the same
  reason. The launch path already reads SWARMFORGE_OLLAMA_BINARY, which is
  the seam a fixture can name its stub through.

  # BL-1797 the-stub-runs-whatever-zshenv-puts-first-01
  Scenario: the gate test passes and never runs a decoy a zshenv puts ahead of its stub
    Given a zsh startup directory whose .zshenv puts a decoy ollama first on PATH
    When the ollama ancillary launch gate test runs with that startup directory
    Then it prints ALL PASS and exits 0
    And the decoy never ran
