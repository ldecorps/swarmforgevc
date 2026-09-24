Feature: BL-1718 No step handler loads the cursor-bridge live graph at module scope

  The module-load guard (BL-1630) charges each step handler for what it
  loads at require time. bl709's handler and bl725's require
  extension/out/tools/telegramCursorBridgeLive at module scope, a 211-module
  graph that costs about 230 ms on a quiet host and measured 530 ms, the
  fastest of three, at load 10 on 2026-09-24. The census order charges it
  all to bl709. Eleven other handlers that mention the module already
  require it inside their steps. This feature is that none requires it at
  module scope. The guard's timing stays the register's concern; the
  mechanism is what is gated here.

  # BL-1718 no-module-scope-require-of-the-cursor-bridge-live-module-01
  Scenario: no step handler requires telegramCursorBridgeLive at module scope
    When every step handler file under specs/pipeline/steps is read
    Then none requires telegramCursorBridgeLive at module scope
    And the handlers that mention telegramCursorBridgeLive include bl709BubbleItsOwnTelegramTopicSteps.js and bl725RenameCursorRemoteTopicToHostSteps.js
