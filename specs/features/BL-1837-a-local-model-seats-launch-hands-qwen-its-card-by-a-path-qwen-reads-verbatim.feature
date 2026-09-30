Feature: BL-1837 A local-model seat's launch hands qwen its card by a path qwen reads back verbatim

  qwen treats "@<path>" in a prompt as a file reference and rewrites it.
  The launch prompt names the card as '.../.swarmforge/prompts/coder@iq3.md',
  and all three coder@iq3 sessions on 2026-09-30 received
  '.../prompts/coder @iq3.md' instead (qwen chats 9f06a797, 6119e423 and
  992f20dc): each spent its first two turns on "File not found" and a glob
  before reading the card. The same line also calls the file
  "(constitution, pipeline, role, pack)", which describes the generic
  composition, not the compact card a local-model seat gets (BL-1798), and
  the seat went on to read those files. A local-model seat's launch now
  names a card path with no "@" in it and describes the card as its card.

  # BL-1837 the-card-path-carries-no-at-sign-01
  Scenario: the seat's launch prompt names its card by a path with no "@"
    Given a pack whose window line is "window coder@iq3 local-model coder-iq3 --model ista-iq3s-coder:latest"
    When the swarm writes the seat's launch script
    Then the qwen prompt in it contains no "@"
    And the card path it names holds the seat's composed coder card

  # BL-1837 the-launch-prompt-does-not-describe-the-generic-composition-02
  Scenario: the launch prompt does not describe the card as the generic composition
    Given a pack whose window line is "window coder@iq3 local-model coder-iq3 --model ista-iq3s-coder:latest"
    When the swarm writes the seat's launch script
    Then the qwen prompt in it does not contain "(constitution, pipeline, role, pack)"

  # BL-1837 a-claude-seat-keeps-its-prompt-file-03
  Scenario: a Claude seat named with "@" keeps its prompt file
    Given a pack whose window line is "window coder@2 claude coder2 --model claude-sonnet-5"
    When the swarm writes the seat's launch script
    Then it appends the system prompt file ".swarmforge/prompts/coder@2.md"
