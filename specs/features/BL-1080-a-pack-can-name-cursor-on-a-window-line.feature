Feature: an operator can choose a Cursor seat on purpose

  BL-1080: with BL-1078's launcher token and BL-1079's certified identity in
  place, a Cursor seat is possible but not choosable. No committed pack names
  `cursor` on a window line, so an operator has nothing to pass to `--pack`;
  and the launcher's unsupported-agent refusal — emitted from two separate
  sites, the allow-list check and the launch-command builder — says only that
  the agent is unsupported. An operator who guesses `cursor` on an older
  checkout, or misspells it on this one, is told no and given nowhere to go.

  This slice ships the pack line, the how-to that says when a Cursor seat is
  the right choice against `/pilot` and against Claude, and makes every
  unsupported-agent refusal name that how-to by path. The refusal keeps its
  existing wording ahead of the pointer, so the checks that already assert on
  it are unaffected.

  The pointer is swept across refusal sites rather than fixed at one of them:
  BL-1018 repaired one member of a seven-site family and left the rest, and
  the same family shape is here.

  # BL-1080 pack-can-name-cursor-on-a-window-line-01
  Scenario: a committed pack staffs a role with a Cursor seat
    Given the committed packs directory
    When the Cursor seat pack is parsed
    Then it names at least one role whose agent is cursor
    And that pack is selectable by name at launch

  # BL-1080 pack-can-name-cursor-on-a-window-line-02
  Scenario: every unsupported-agent refusal names the Cursor-seat how-to
    Given the launcher source
    When every unsupported-agent refusal it can emit is enumerated
    Then each one names the Cursor-seat how-to by path
    And more than one refusal site is found

  # BL-1080 pack-can-name-cursor-on-a-window-line-03
  Scenario: the how-to a refusal names is committed, not a dead end
    Given a refusal emitted for an unsupported agent
    When the how-to path it names is resolved against the repository
    Then a committed file is found at that path
