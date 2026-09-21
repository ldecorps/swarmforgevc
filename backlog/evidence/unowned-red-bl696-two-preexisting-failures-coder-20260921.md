# coder pass — two unowned pre-existing reds in BL-696's acceptance features, 2026-09-21

While verifying BL-1658's lazy-load fix for `bl696LetsTalkSteps.js` and
`bl696TelegramCursorBridgeOperatorSteps.js` (two of the fifteen eager
cursor-bridge requirers), their own acceptance features each fail one
scenario, confirmed pre-existing by stashing each file's BL-1658 edit
(restoring the original eager-require version), rerunning, and getting
the identical failure before restoring the fix (`git stash apply` /
`git stash drop` each time — both files are byte-identical to before
this check).

## D1 — BL-696 miniapp Let's Talk, scenario "a transient speech-to-text
failure is recoverable and does not wedge the session"

```
Then the page shows conversation state "error" only while retrying:
The input did not match the regular expression /setPhase\('error'\)/.
```
7/8 pass, this one scenario fails identically with or without BL-1658's
change - a content check against the served `/lets-talk` page's script
text.

## D2 — BL-696 Telegram operator commands, scenario "/redeploy compiles
and restarts the supervised bridge"

```
Then the bridge decision is to redeploy: Expected values to be strictly
deep-equal:
+ { action: 'prompt-operator-confirm', args: undefined, tier: 'soft', verb: '/redeploy' }
- { action: 'redeploy', ... }
```
19/20 pass, this one scenario fails identically with or without BL-1658's
change - `decideInboundAction`'s own `/redeploy` decision now reads as a
soft confirm-gated tier rather than an immediate redeploy.

Neither failure is anything BL-1658's require-timing fix touches - it
never edits `letsTalkUiHtml`/the served page script, nor
`decideInboundAction`'s own decision logic, only where each file's
heavy modules are required.

## Search for an existing owner

Grepped `backlog/standing-reds.tsv` for `696`, `setPhase('error')`,
`redeploy`, `prompt-operator-confirm` — no row. Grepped `backlog/active`,
`backlog/paused` for `696` — only BL-1658 itself, which names both files
as cursor-bridge handlers it fixes for require-timing, not for either
scenario's own content — nothing open owns either failure.

## Disposition

Filing as one `unowned-red` `note` (priority 00) to specifier and
coordinator per the standing-red rule (2026-09-05), covering both, and
continuing BL-1658's own work — QA will not approve BL-1658 over these
unless registered with an owning ticket by the time it reaches QA.

By coder.
