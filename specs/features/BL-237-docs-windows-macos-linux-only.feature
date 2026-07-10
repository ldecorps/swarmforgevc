Feature: product docs state macOS/Linux only, matching the tmux-substrate reality

  # Roadmap gap-scan 2026-07-10 (doc-vs-reality contradiction; operator ruling:
  # fix the docs to macOS/Linux only). Milestone Roadmap.MD:154, Specification.MD:40
  # and :1457 claim native Windows is first-class and the reason the extension owns
  # orchestration instead of tmux. That contradicts the governing constitution:
  # local-engineering.prompt says "Target OS: macOS and Linux only" with tmux as the
  # process substrate, and BL-091 (done) rules native Windows out of scope. This item
  # corrects the docs to match; it changes documentation only, no product behavior.

  Background:
    Given the product docs Milestone Roadmap.MD and Specification.MD

  # BL-237 no-windows-first-class-01
  Scenario: the docs no longer claim native Windows is first-class or the design driver
    Given the sections describing target platforms and why the extension is built as it is
    When those sections are read
    Then they do not claim native Windows support is first-class or the reason for owning orchestration

  # BL-237 macos-linux-only-02
  Scenario: the docs state macOS and Linux only with tmux as the substrate
    Given the sections stating supported platforms
    When those sections are read
    Then they state macOS and Linux only, with tmux as the process substrate

  # BL-237 aligns-constitution-03
  Scenario: the corrected docs agree with the constitution and BL-091
    Given local-engineering.prompt states macOS/Linux only and BL-091 rules native Windows out of scope
    When the corrected docs are compared against them
    Then no Windows-native contradiction remains between the docs and the constitution
