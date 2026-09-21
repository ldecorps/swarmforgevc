# coder pass — unowned red in BL-1384's acceptance feature, 2026-09-21

While verifying BL-1658's lazy-load fix for
`bl1384LocalSeatTopicForwardedSteps.js` (one of the fifteen eager
cursor-bridge requirers), its own acceptance feature
(`specs/features/BL-1384-the-local-seat-topic-reaches-the-bridge-through-the-front-desk.feature`)
fails scenario 02, "the bridge draining the queue answers in the local
seat topic":

```
Then "Hello from qwen" is posted in topic 4242: expected "Hello from
qwen" posted in topic 4242: [{"topicId":4242,"message":"Local seat
cannot answer: the endpoint is up but does not hold
\"qwen2.5-coder:latest\" (it holds: qwen3:14b). Endpoint
http://fixture.invalid. No other seat has been asked."}]
```

## Confirmed not caused by BL-1658's changes

Stashed the BL-1658 lazy-load edit to this file (restoring the ORIGINAL
eager-require version), reran the same feature: identical failure, same
message, same scenario. Restored the fix afterward (`git stash apply`,
`git stash drop`) — the file is byte-identical to before this check.

The failure reads like a real-model-catalogue check
(`runLocalSeatTurn`'s endpoint probe reports the actual locally-installed
Ollama model as `qwen3:14b`, not the fixture's expected
`qwen2.5-coder:latest`) rather than anything BL-1658's require-timing fix
touches — this parcel never edits `runLocalSeatTurn`'s logic, only where
`localQwenSeatLive` (among four other modules) is required.

## Search for an existing owner

Grepped `backlog/standing-reds.tsv` for `1384`, `qwen2.5-coder`,
`localSeatTurn`, `local seat` — no row. Grepped `backlog/active`,
`backlog/paused` for `1384` — only BL-1658 itself, which names
bl1384LocalSeatTopicForwardedSteps.js as one of the fifteen cursor-bridge
handlers it fixes for require-timing, not for this scenario's own
content — nothing open owns this failure.

## Disposition

Filing as an `unowned-red` `note` (priority 00) to specifier and
coordinator per the standing-red rule (2026-09-05) and continuing
BL-1658's own work — QA will not approve BL-1658 over this unless it is
registered with an owning ticket by the time it reaches QA.

By coder.
