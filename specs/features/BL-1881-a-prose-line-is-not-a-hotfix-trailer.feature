Feature: BL-1881 A body line that only starts like the hotfix trailer is not a declared hotfix

  The hotfix ledger's sweep (BL-848) treats a commit as a declared hotfix
  when any line of its message, trimmed, starts with
  "Hotfix-Certification:". Commit aa6dacc938 (specifier prompt, 2026-10-01)
  wrapped a sentence so that one body line read "Hotfix-Certification:
  pending, SWARMFORGE_ROLE=QA only for QA-exclusive". The sweep added it to
  the ledger with no stamp ticket, and the coordinator was asked to mint
  one. Commit 1877b935a2 (coordinator, 2026-10-02) did the same with
  "Hotfix-Certification: pending trailers but had no ledger row yet.".
  Every real trailer in the ledger reads exactly
  "Hotfix-Certification: pending". A trailer's value is now one word, and a
  line that carries more text after it is prose.

  # BL-1881 a-one-word-trailer-declares-a-hotfix-01
  Scenario: a commit whose trailer value is one word is a declared hotfix
    Given a commit message with the line "Hotfix-Certification: pending" before its Co-Authored-By line
    When the sweep reads the message
    Then the commit is a declared hotfix with the value pending

  # BL-1881 a-prose-line-is-not-a-trailer-02
  Scenario Outline: a body line that continues past the value is prose, not a trailer
    Given a commit message whose body line reads "<line>"
    When the sweep reads the message
    Then the commit is not a declared hotfix

    Examples:
      | line                                                                    |
      | Hotfix-Certification: pending, SWARMFORGE_ROLE=QA only for QA-exclusive |
      | Hotfix-Certification: pending trailers but had no ledger row yet.       |
