# Adjudication: unowned red x2, BL-696's acceptance features (lets-talk-06, tg-op-04) - 2026-09-21 (specifier)

**Inbound.** Coder note, priority 00, 2026-09-21T14:09:55Z
(00_20260921T140955Z_000047_from_coder), from inside BL-1658 whose parcel
migrates both bl696 handlers: "unowned-red BL-696 x2: lets-talk
error-phase HTML + /redeploy decision". Coder evidence (coder@2 branch):
`backlog/evidence/unowned-red-bl696-two-preexisting-failures-coder-20260921.md`
- both reds reproduced on the original handlers with the BL-1658 edit
stashed.

**Reproduced from the master checkout, one run each.**
- `BL-696-miniapp-lets-talk-cursor-audio.feature` scenario 06 (TAP 6),
  "a transient speech-to-text failure is recoverable and does not wedge
  the session": `The input did not match the regular expression
  /setPhase\('error'\)/` on the served `/lets-talk` page (7/8 pass).
- `BL-696-telegram-cursor-bridge-operator-commands.feature` scenario
  tg-op-04 (TAP 6), "/redeploy compiles and restarts the supervised
  bridge": decision is `{ action: 'prompt-operator-confirm', tier:
  'soft', verb: '/redeploy' }`, expected `{ action: 'redeploy' }` (19/20).

**Successors (BL-1006 shape, both left red by the same batch land).**
- lets-talk-06: BL-696's own post-ship UX, c0f7d4b57a (2026-07-29
  16:15:15, "document Let's Talk operator console and land post-ship UX"),
  removed `setPhase('error')` from `extension/src/bridge/letsTalkUiHtml.ts`
  (its diff line 828). Today a failed turn shows an inline error
  (`showError`), marks bridge health degraded (`agent: error`) and returns
  the phase to `ready` - no `error` phase exists in the page. The step's
  other assertion (`phaseTrace` starting `['error','thinking']`) is fed by
  the handler's own client-retry fixture, not the page, so the regex was
  the scenario's only real check of the surface. The server half still
  holds: `letsTalkCore.ts` `sttRetryFailure` returns `recoverable: true,
  state: 'error'` and the retried turn completes.
- tg-op-04: BL-702 (done; `telegramCursorBridgeCore.ts` line 454 "BL-702:
  /redeploy is gated via operator soft confirm (not fire-and-forget)"),
  landed in f9b38f53d1 (2026-07-29 16:15:15, "Land Cursor Remote operator
  slices BL-700-704"). The help text lists `/redeploy - soft confirm,
  then compile and restart this bridge`. BL-702's and BL-710's features
  carry the confirm flow; BL-1204 the targets.
Both handlers predate that minute (c98e1c8d84 07-28, 4c5c4bb2a2 07-29
16:15:14); red on main for eight weeks, unrun by any lane, first sighted
by the coder because BL-1658 touches both handlers' require lines.

**Ruling: one owner, BL-1681 (defect, high - two standing reds;
auto-approved, no choice posed).** Retire lets-talk-06 and tg-op-04 -
retire, never reword (BL-1006: the successors' scenarios are the
coverage). The still-true half of lets-talk-06 - a transient STT failure
is reported recoverable and the retried turn completes - is a SERVER
contract and moves into BL-1681's own feature as a scenario over the
turn route, with no page literal. Step definitions used by no remaining
scenario ("the bridge decision is to redeploy", "the bridge posts a
redeploy started confirmation", "the page shows conversation state
'error' only while retrying") are removed after the grep the
engineering rule requires. Two register rows (acceptance lane, one per
feature file) name BL-1681; first_seen 2026-09-21 (first sighting).
Orthogonality: BL-1681 edits both bl696 handlers that BL-1658 (active)
edits - promote after BL-1658 lands.

**Pattern for the ceremony (not a ticket today).** Four reds in landed
features surfaced in ONE parcel today (BL-687 sc06, BL-1384 sc02, BL-696
x2), every one weeks old, because no lane runs a landed feature until a
parcel touches its handler. Recorded here for the shift-end lean pass.

**Notes sent.** coder (owner + resume), coordinator (ready in paused,
after BL-1658).

By specifier.
