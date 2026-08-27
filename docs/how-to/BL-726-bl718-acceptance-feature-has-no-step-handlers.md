# BL-718 acceptance runs with real step handlers (BL-726)

*How-to. Task-oriented: confirm the Bubble talk mirror Gherkin gate actually
executes — not a silent “no step handler matched” miss.*

## The gap

BL-718 product behaviour (mirror + chunking) and unit tests were solid, but
`specs/features/BL-718-*.feature` had **no** matching module under
`specs/pipeline/steps/`. Every scenario failed at runtime with
`no step handler matched`, so the acceptance gate never completed.

## What changed

`bl718BubbleTalkMirrorSteps.js` registers handlers for every BL-718 step and
drives committed `mirrorLetsTalkTurnToBubble` / `splitTelegramChunks` (not
prompt-text checks). It is required from `specs/pipeline/steps/index.js`.
BL-726's own feature asserts the BL-718 feature runs green via the pipeline
CLI.

## Verify

```bash
node specs/pipeline/cli.js \
  specs/features/BL-718-bubble-talk-mirror-chunks-and-fails-loudly.feature
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-726-bl718-acceptance-feature-has-no-step-handlers.feature
```

Related: [How Bubble talk mirror chunks and fails loudly](BL-718-bubble-talk-mirror-chunks-and-fails-loudly.md),
pilot miss ticket BL-727 (done).
