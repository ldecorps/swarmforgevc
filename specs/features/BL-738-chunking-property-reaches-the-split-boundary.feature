Feature: the chunking property test can actually fail

  BL-718 declares the invariant "Mirror delivery is length-independent: a reply
  of any length reaches the Bubble topic complete and in order, or fails loudly
  — length alone never silently truncates or drops a transcript." Per BL-654 a
  declared invariant is carried by a coder-authored property test, and
  cursorBridgeLive.property.test.js does carry one: "property:
  splitTelegramChunks reassembles without loss for short strings".

  It cannot fail. Its generator is fc.string({ maxLength: 200 }) and it calls
  splitTelegramChunks(text) with no second argument, so maxLen defaults to
  TELEGRAM_MESSAGE_MAX_LENGTH = 4096. Every generated input satisfies
  text.length <= maxLen, so every one of the 80 runs takes the early return
  `return [text]` and the assertion chunks.join('') === text is trivially true.
  The split/rejoin loop the invariant is actually about — lastIndexOf('\n',
  maxLen), the slice, the leading-newline trim, the final remainder push —
  never executes even once. Breaking that loop on purpose leaves the property
  fully green, which is the definition of a vacuous test.

  This is a rigor gap, not a live truncation risk: telegramCursorBridgeCore.test.js
  independently covers the multi-chunk case by example, including 'a'.repeat(5000)
  at the real boundary. What is missing is the property's own ability to
  falsify — the thing that makes it worth having alongside those examples.

  The generator bound and the implementation's boundary are two numbers that
  must relate, and 200 versus 4096 is what happens when one of them is written
  down by hand and the other moves. Whatever fix is chosen, the property must
  keep reaching across the boundary when TELEGRAM_MESSAGE_MAX_LENGTH changes.

  # BL-738 chunking-property-01
  Scenario: the property exercises the multi-chunk branch
    Given the chunking property test as committed
    When the property lane runs the chunking property
    Then at least one generated input is split into more than one chunk

  # BL-738 chunking-property-02
  Scenario: breaking the multi-chunk branch turns the property red
    Given a splitTelegramChunks whose multi-chunk branch drops the first character of each continuation
    When the property lane runs the chunking property
    Then the property fails and names the losing input
