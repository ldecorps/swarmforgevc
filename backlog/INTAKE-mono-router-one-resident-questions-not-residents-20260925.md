# INTAKE — DEFECT: mono-router's "consult" installs a temporary secondary resident; only a question-scoped ephemeral agent is allowed

**Source:** the human, via Claude Code (operator), 2026-09-25, while a second
live specifier was found in the freshly onboarded `gpu-bargain-hunter` swarm.
Verbatim (Article 5.3):

> Yes, enforce 1 resident at any one time

> It's a basic rule of the monorouter, right? The central tenet. Mono router = 1 resident

> Having said that, an agent can spin an ephemeral other agent if it has a question for it. But that is not quite the same thing as installing a secondary resident.

**Kind:** defect against the pack's own definition. `swarmforge/packs/mono-router.conf`
line 1: "ONE resident pipeline agent that plays every role in turn". The
consult mechanism (hotfix 2026-09-12, certified as BL-1549; single-slot
refusal BL-1706) breaks that tenet by construction.

**Recommended severity: medium.** There is no live exposure today:
- this repo's day shift runs `full-forge`, which has standing seats and no
  resident, so consult never fires there;
- `gpu-bargain-hunter` refuses consult outright as an interim
  (`config single_inference_slot 1`, commit ad9a028 in that repo). That is
  stricter than the human's rule: it blocks legitimate question consults
  too. Lift it once this lands.

## What happened (gpu-bargain-hunter, 2026-09-25)

The resident was mid-turn as documenter, working a morning-briefing nudge
from handoffd's own `briefing-generation` sweep. Specifier had pending work:
draining the seed-vision intake. handoffd.log:

    10:40:38.950Z chase-rotate-seated-preferred-yield documenter specifier
    10:40:38.963Z chase-rotate-departing-mid-parcel specifier
    10:40:38.969Z consult-spawn specifier requested-by=documenter

- A dedicated `swarmforge-specifier` session appeared (tmux: created 11:40:38
  local). Its marker was `.swarmforge/daemon/consult/specifier.json`,
  `requested_by: documenter`.
- The resident then rotated to specifier as well. Two specifiers were live
  and both were draining the same intake, each asking the human a different
  question about it.
- Nothing had been minted yet. The operator killed the consult session and
  set the interim knob; the session stayed down for 90 s of chase sweeps.

## Why this is a secondary resident, not a question (code, read 2026-09-25)

- **The trigger is any waiting mail, work included.** `consult-eligible?`
  (`swarmforge/scripts/mono_router_lib.bb:656`) fires on the chase's
  `:departing-mid-parcel` refusal for whatever actionable mail the target
  role has: git_handoff parcels, intake drains, notes alike. Its own
  docstring cites the motivating case as "often a direct question FROM the
  departing role (e.g. QA asking specifier to adjudicate)", but nothing
  restricts it to that.
- **The session is the full role, not a scoped helper.**
  `spawn-consult-session!` (`handoffd.bb:1791`) launches the role's full
  `launch/<role>.sh`, which is the whole role loop: `ready_for_next.sh`,
  parcel claims, and for specifier, draining the backlog root.
- **It lives until the mailbox is empty.** `consult-teardown-sweep!`
  (`handoffd.bb:1828`) tears the session down only once it is quiet and the
  role's mailbox holds no actionable mail. It works everything, not one
  question.
- **The CLI path is ungated.** `consult_spawn_cli.bb` never consults
  `consult-eligible?` or `single_inference_slot`. Its caller,
  `night-closing-ceremony-run.ts` `rotateDocumenter`, uses it to get a
  documenter that WRITES the morning briefing. That is work.

## Ask

1. **Chase never spawns a session to serve work.** A target role's parcels
   and intakes wait for the resident, and chase rotates the resident once
   its current turn ends. This is a delay, not a deadlock: the consult gate
   only ever fired while the resident was actively mid-turn.
2. **A question gets an ephemeral agent** (the human's words). It answers
   the one question addressed to it by the asking role, then exits. It
   never enters the role loop, never claims a parcel, never drains an
   intake, and never outlives its question. The specifier decides how a
   question is recognized (handoff type, role_ask, a dedicated verb) and
   how the helper is launched (a one-shot run, like the intake form's
   Verify/Ask design in BL-1735/BL-1737, is prior art in this backlog).
3. **The ceremony's briefing is work,** so it goes to the resident.
   `consult_spawn_cli.bb` must not start a documenter session beside a
   seated resident. Whether the ceremony waits for, or rotates, the resident
   before stopping the swarm is a real choice: put it to the human with the
   trade-off. The risk is a missed briefing if the resident stays busy
   until shutdown; it only bites when a router pack runs at ceremony time.
4. **Contracts and code move together.** Change these with it in the same
   parcel, or they become the next unowned red. That is today's exact QA
   stall class: BL-1724, held 2h+ on unowned reds.
   - BL-1549 and BL-1706's feature files.
   - `swarmforge/scripts/test/mono_router_lib_test_runner.bb`: ~10
     `consult-eligible?` assertions, some asserting eligibility.
   - `swarmforge/scripts/test/test_consult_spawn_cli.sh`.
   - `extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js`,
     which runs the REAL `consult_spawn_cli.bb` in the standing unit lane
     and asserts a documenter session is spawned.
5. **Once 1–2 hold, `single_inference_slot` is redundant.** Remove the knob
   and its parsing, and lift gpu-bargain-hunter's interim setting.

Draft acceptance (the specifier refines at mint):

```gherkin
Scenario: Work mail waits for the resident instead of spawning a seat
  Given a mono-router resident mid-turn as documenter
  And specifier's mailbox holds a git_handoff parcel
  When the chase sweep runs
  Then no second session is started
  And specifier's parcel is served once the resident rotates to specifier

Scenario: A question gets an ephemeral agent that exits after answering
  Given a mono-router resident mid-turn as QA
  And QA has asked specifier a question
  When the question is served
  Then an ephemeral specifier answers that question
  And it claims no parcel and drains no intake
  And it has exited once the answer is delivered

Scenario: The ceremony never starts a documenter beside a seated resident
  Given a mono-router resident mid-parcel as coder
  When the night closing ceremony needs the morning briefing
  Then no documenter session is started beside the resident
```
