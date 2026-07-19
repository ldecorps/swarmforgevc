# mutation-stamp: sha256=03b2ca06fc1e59559da3c739d241c9c02dde60462b6ee61859b358ce126f2f7f
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-19T18:15:23.685735723Z","feature_name":"The pipeline board's updated-at footer shows the time in UK (Europe/London) time, DST-aware, instead of UTC","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-508-pipeline-board-updated-at-uk-time.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"The updated-at footer renders the instant in UK time, DST-aware, with its zone","scenario_hash":"088f03a05fcc816cb1870aa6d077eb9c069ea49f5ea3e757d031ce51de140a5a","mutation_count":9,"result":{"Total":9,"Killed":9,"Survived":0,"Errors":0},"tested_at":"2026-07-19T18:15:23.685735723Z"}]}
# acceptance-mutation-manifest-end

Feature: The pipeline board's updated-at footer shows the time in UK (Europe/London) time, DST-aware, instead of UTC

  # BL-508 (human-requested — ldecorps 2026-07-17, direct: "one more tweak to bake in: can you show the
  # update time in UK time"). The board's footer currently renders "updated at MMM DD HH:MM" in UTC
  # (extension/src/concierge/pipelineBoard.ts formatUpdatedAtLabel — every field read via getUTC*). The
  # human reads the board on a UK phone and wants the update time in their own wall-clock.
  #
  # "UK time" is the Europe/London zone, which is DST-aware: British Summer Time (BST, UTC+1) from late
  # March to late October, Greenwich Mean Time (GMT, UTC+0) the rest of the year. A naive fixed +1 offset
  # would be WRONG for half the year — the render must use the Europe/London zone so the offset (and any
  # date rollover it causes) follows DST automatically.
  #
  # THE CONTRACT (behaviour pinned; exact glyphs a build-time cosmetic detail per BL-462's own footer
  # note):
  #   1. The updated-at footer renders the injected last-content-change instant in Europe/London
  #      wall-clock time — BST in summer (so a 20:05 UTC instant shows 21:05), GMT in winter (a 03:07 UTC
  #      instant still shows 03:07). The zone shift also moves the DATE where it crosses midnight (a
  #      23:30 UTC June instant shows the next day in BST).
  #   2. The footer carries an explicit UK zone marker (BST / GMT) so the time is unambiguous and cannot
  #      be misread as the UTC it used to be.
  #   3. UNCHANGED: formatUpdatedAtLabel stays a PURE function of its injected epoch-ms (engineering
  #      no-real-clock rule — never a bare new Date()/Date.now()); Europe/London formatting of a fixed
  #      epoch is deterministic, so same epoch still yields the same label. The footer is still EXCLUDED
  #      from pipelineBoardSync.ts's content signature (renderPipelineBoardBody), so this change does not
  #      by itself trigger a repost — it takes visible effect on the next content-triggered repost.
  #
  # Scope (grep-confirm the live path at build):
  #   - extension/src/concierge/pipelineBoard.ts formatUpdatedAtLabel: format the injected epoch in the
  #     Europe/London zone (e.g. via Intl.DateTimeFormat with timeZone 'Europe/London', which is
  #     DST-aware and deterministic given the epoch), append the zone marker. Keep it pure and keep the
  #     renderUpdatedAtFooter / renderPipelineBoard callers unchanged in shape.
  #   - extension/test/pipelineBoard.test.js ~L405-412: the two existing unit tests pin the UTC output
  #     ("Jul 16 20:05", "Jan 05 03:07") — update them to the Europe/London expectation (Jul -> 21:05 BST,
  #     Jan -> 03:07 GMT); together they already exercise BOTH DST states, so they are the DST proof. Fix
  #     the test NAME ("...in UTC" -> "...in UK/London time"). The BL-462 acceptance step
  #     (bl462PipelineBoardRefinementsSteps.js:221) derives its expected footer from formatUpdatedAtLabel
  #     itself, so it stays green with no edit — confirm at build.
  #
  # E2E QA PROCEDURE: in-process, call the footer render with a fixed summer epoch and a fixed winter
  # epoch and confirm the summer one reads one hour ahead of UTC with a "BST" marker while the winter one
  # matches UTC with a "GMT" marker; confirm a near-midnight summer epoch rolls the DATE forward. Then
  # render over the live board and eyeball that "updated at" now reads UK time with its zone. Verify
  # against the real surface, not only a fixture (BL-335).

  # BL-508 board-updated-at-uk-01
  Scenario Outline: The updated-at footer renders the instant in UK time, DST-aware, with its zone
    Given the last content-change instant is "<utc>" in UTC
    When the pipeline board footer is rendered
    Then the footer shows "<uk>" with the "<zone>" zone marker

    Examples:
      | utc          | uk           | zone |
      | Jul 16 20:05 | Jul 16 21:05 | BST  |
      | Jan 05 03:07 | Jan 05 03:07 | GMT  |
      | Jun 30 23:30 | Jul 01 00:30 | BST  |
