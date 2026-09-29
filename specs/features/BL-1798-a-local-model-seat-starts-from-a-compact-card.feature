Feature: BL-1798 A local-model seat starts from a compact card

  A local-model seat (the qwen agentic CLI against a loopback model)
  reads the prompt file the prompt factory composes at launch. Today that
  is the generic composition: the whole constitution, PIPELINE and role
  prompt, 58,371 characters for the coder and 231,796 for the hardender,
  measured 2026-09-29. A small local model loses the role loop in it, and
  Ollama silently drops what overflows its window. Aider seats already
  start from a short note (BL-1699). The factory now gives a local-model
  seat a compact card: a shared loop card plus the role's own card, which
  points at where the full text lives instead of inlining it. Every other
  agent composes exactly as before.

  # BL-1798 a-local-model-coder-composes-its-card-within-budget-01
  Scenario: a local-model coder's composed prompt is its card, within 8192 characters
    When the prompt factory composes the "coder" prompt for the "local-model" agent
    Then the composed prompt is at most 8192 characters
    And it names ready_for_next.sh, done_with_current.sh and swarm_handoff.sh
    And it names swarmforge/roles/coder.prompt and swarmforge/constitution.prompt as where the full text lives

  # BL-1798 a-local-model-role-with-no-card-composes-as-today-02
  Scenario: a local-model role with no card composes exactly as today
    When the prompt factory composes the "operator" prompt for the "local-model" agent
    Then the composed prompt equals the generic composition of that role

  # BL-1798 only-local-model-takes-the-compact-style-03
  Scenario Outline: the factory picks the compact style for the local-model agent only
    When the prompt factory composes the "coder" prompt for the "<agent>" agent
    Then its metadata names the "<style>" bootstrap text style

    Examples:
      | agent       | style         |
      | claude      | generic       |
      | codex       | generic       |
      | gemini      | generic       |
      | cursor      | generic       |
      | aider       | aider         |
      | local-model | local-compact |
