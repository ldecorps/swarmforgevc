Feature: BL-1845 A local-model seat's qwen runs interactive, so its pane shows its work and takes typed input

  The swarm launched a local-model seat's qwen with its kickoff prompt as
  a bare argument. qwen 0.22.2 reads a bare argument as --prompt, which
  runs one prompt headless: no screen, only the final answer printed when
  the run ends, and no keyboard input. The coder@iq3 pane on 2026-09-30
  showed nothing of what qwen was doing, had no input box for the human
  to steer it, and never read the wakes handoffd types into a pane, so
  the seat saw new mail only when it was relaunched. qwen's interactive
  prompt option (-i, long form --prompt-interactive) runs the same prompt
  as the first message of an interactive session instead. A local-model
  seat's launch now hands qwen its kickoff that way.

  Background:
    Given the pack staffs "window coder@iq3 local-model coder-iq3 --model ista-iq3s-coder:latest"

  # BL-1845 kickoff-rides-the-interactive-prompt-option-01
  Scenario: the seat's launch hands qwen its kickoff as the first message of an interactive session
    When the seat's launch script is generated
    Then qwen's interactive prompt option carries the kickoff prompt
    And that kickoff names a file under ".swarmforge/prompts/" and "ready_for_next.sh"

  # BL-1845 qwen-is-never-started-headless-02
  Scenario: the seat's launch never starts qwen headless
    When the seat's launch script is generated
    Then no prompt reaches qwen through "-p", "--prompt" or a bare argument
