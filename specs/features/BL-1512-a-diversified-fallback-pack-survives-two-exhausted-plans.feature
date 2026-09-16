Feature: BL-1512 A diversified fallback pack survives b.ai and Anthropic being exhausted together

  Every seat's first fallback is Anthropic, so anthropic-mono-router.conf
  already IS the tier-1 fallback pack. What is missing is a tier-2 pack
  for the case where BOTH b.ai and Anthropic are exhausted at once: one
  certified pick per seat from another plan, chosen for provider
  diversity so one exhausted plan degrades one tier, not the whole swarm.
  This feature is that pack, its header rationale, and the proof that its
  lines are shaped for the staffing gate: derived as the launcher derives
  them and decided on steward evidence, the cursor and qwen lines pass
  when a fixture certifies them and the qwen line refuses when its
  documenter gate is missing. Whether the live launch root certifies each
  pick is QA's e2e check on that root, never a scenario, because the
  steward state is gitignored per-worktree runtime data. The two codex
  lines cannot be resolved by the gate at all until BL-1597 lands and are
  asserted nowhere here.

  # BL-1512 diversified-fallback-pack-01
  Scenario: every pipeline seat is staffed from a plan that is neither b.ai nor Anthropic
    When candidate-diversified-fallback-mono-router.conf is parsed
    Then each of specifier, coder, cleaner, architect, hardender, documenter and QA has one window line
    And none of those lines resolves to the anthropic or the tencentcloud2 provider
    And the cursor lines resolve to the cursor provider and the documenter line to the qwen provider

  # BL-1512 diversified-fallback-pack-02
  Scenario Outline: the staffing gate reads the pack's window lines as the launcher does and decides the cursor and qwen lines on steward evidence
    Given a scratch root whose steward registry ranks cursor/auto on specifier, cleaner, hardender and QA and qwen/qwen3.7-plus on documenter, with <scorecards>
    And PACK_STAFFING_SKIP_GATE is unset
    When the pack staffing gate runs on the windows-file derived from the pack by the launcher's field rules
    Then the derived windows-file holds exactly 7 window lines
    And <verdicts>

    Examples:
      | scorecards                                                   | verdicts                                                                              |
      | every one of those role gates recorded pass                  | the four cursor lines and the documenter line read pass                               |
      | every one of those role gates recorded pass except documenter | the four cursor lines read pass and the documenter line refuses role-gate-not-pass   |

  # BL-1512 diversified-fallback-pack-03
  Scenario: the coordinator seat follows the human ruling and the header says what was proven and what the gate refuses
    When the pack header is read
    Then the coordinator seat matches the ticket's human ruling
    And the header states which coordinator picks were proven live and which were not
    And its LAUNCH line carries PACK_STAFFING_SKIP_GATE=1 and its PREREQ names the codex lines as unresolved by the gate and the documenter line as lacking a recorded documenter gate
