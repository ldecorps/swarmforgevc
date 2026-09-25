# INTAKE — An "Intake" Telegram topic whose Mini App form writes intakes in one ubiquitous language, with Verify and an Ask-specifier voice panel (QUEUE-JUMP, directly behind the local-LLM slices)

**Source:** the human, via Claude Code acting as specifier for the
clarification round, 2026-09-25. Verbatim (Article 5.3: keep these sentences
in every resulting ticket's `source:`):

> New intake - ask me for clarifications before putting it in, as if you were the swarm specifier.
>
> I want a new specialised topic in telegram for helping me inputing new intakes.
> I am to start by defining a overall goal in thus form
>
> As a user
> I want to do this action
> So i can acheive this goal
>
> I want "a user", "do this action" and "acheive this goal" to be drop down lists populated with what the previous the previous intakes have. This to enforce ubiiquitous language.
> I can add a new value to the dropdown in case uts empty or does not contain what I want.
>
> Then I want to add one or more gherkins scenarios.
> Given some state
> When something happens
> Then some other state
>
> Add a "verify" button to have the intake given to the specifier so that it can run is usual skills on it (dry, invest, etc), so he maybcome back with improvements for the pending intake. I can accept or not his changes.
>
> Add a submit button so the intake is put in the usual queue.

> Can I also get a "ask specifier" button ? If I want interactive helpnfrom him while working on this? A push to talk and a tts talking back to me would be great, a bit like we have with bubble, but the agent would be the specifier.

> 1: I want to be able to delete what I dont want from dropdown lists.
> 2: qjulp at the back of the local llm slices

**This intake, in its own format:**

    As the human
    I want to file a new intake from my phone
    So I can keep the backlog in one ubiquitous language

**Priority: queue-jump, directly behind the local-LLM slices.** Mint as
`direction: queue-jump`, `human_approval: approved`. The human named the
work and set its place, and under the 2026-09-15 ruling a jump request is the
approval for a plain gate. There is no open ruling: every real choice was put
to the human with its trade-offs and answered (table below).

Encode the place as an ORDERING the gate reads, never as prose and never as
a dependency:
- Prose is read by nothing (BL-1687).
- A `depends_on` on BL-1702 would park this work behind a human ruling and
  a GPU canary.
- The gate sorts by epic priority, then own priority, then id
  (`swarmforge/scripts/promotion_gates_lib.bb`, BL-900). So mint a new epic
  tracker at `priority: 0` and each slice at `priority: 1`.
- That sorts after BL-1698..BL-1702 (epic BL-1125: 0/0) and ahead of the
  older queue-jumped epics BL-1583 (1), BL-1172 (2) and BL-712 (4). If the
  human wants it behind those too, move the tracker to `priority: 5`.

## Clarifications (asked and answered 2026-09-25)

| # | Question | The human's answer |
|---|---|---|
| 1 | Where does the editor live? | A Mini App form, opened from the new topic |
| 2 | History holds ~2 real narratives: how do the dropdowns start? | A curated starter list (below), which then grows from submitted intakes |
| 3 | Who runs Verify, and when? | On demand, at any hour: a one-shot specifier run outside the pipeline |
| 4 | How are its suggestions taken? | One by one, each with Accept/Reject, plus Accept all |
| 5 | How are Given/When/Then entered? | Free text (And/But lines too), checked by IR-DRY at Verify |
| 6 | Can an unverified draft be submitted? | Yes. Verify is optional; the specifier still applies INVEST when it drains the queue |
| 7 | A free-text notes field? | Yes, optional (background, evidence, links) |
| 8 | When does an added value join the shared list? | On Submit. It's usable in the draft at once, so abandoned drafts never pollute the list |
| 9 | While talking, can the specifier change the draft? | It proposes; its changes arrive as the same suggestions as Verify's |
| 10 | What can it see? | The draft, the vocabulary, and the backlog, feature files and docs, read-only |
| 11 | Where can the human talk to it from? | Inside the intake form (v1) |
| 12 | "Push to talk" = hold-to-talk? | No: Let's Talk's existing controls (tap to talk, tap to send, optional hands-free) |
| 13 | Prune the starter list now? | Keep it whole. The human deletes unwanted values from the dropdowns (answer 1 above) |
| 14 | Priority? | Queue-jump, at the back of the local-LLM slices (answer 2 above) |

## Evidence (measured 2026-09-25)

**Why the dropdowns can't be seeded from history.**
- Of 1,382 feature files, 9 contain an "As a" line and only 2 are real
  narratives: "As a user who accesses the miniapp console" and "As a swarm
  operator,". The rest are mid-sentence prose.
- 4 of 95 archived intakes contain one.

**Why steps are free text.** There are 6,109 Given, 6,044 When and 6,141
Then lines, over 19,309 distinct step phrases. The most reused phrase appears
9 times, so a pick-list of steps would be noise.

**Prior art to reuse. Nothing here needs a new mechanism:**
- **Form in Telegram:** the bridge's Mini App pages
  (`extension/src/bridge/consoleMenuUiHtml.ts`, `pipelineGridUiHtml.ts`,
  `epicReorderUiHtml.ts`, `catchUpUiHtml.ts`), served through the bubble
  tunnel. Per the Bot API, an inline `web_app` button works only in private
  chats, so open the form from the forum topic the way the console Mini App
  is already opened.
- **Voice:** Let's Talk (`docs/how-to/BL-696-miniapp-lets-talk-cursor-audio.md`).
  - `processLetsTalkTurn` (`extension/src/bridge/letsTalkRoutes.ts:324`)
    takes its agent as an injected dependency and accepts typed text as well
    as audio.
  - Speech-to-text is local whisper.cpp on the bridge host; replies are
    spoken by the phone's `speechSynthesis` (BL-696 local hybrid audio
    amendment).
  - Hold music, mute, hands-free and a transcript already exist.
- **One-shot Claude run:** `runFrontDeskOneShot`
  (`extension/src/bridge/cursorBridgeAgentSession.ts`) →
  `swarmforge/scripts/run_ancillary_front_desk.sh`.
- **Filing and confirming:**
  - BL-283: a Telegram thread already files an intake.
  - BL-415: a filed intake is confirmed with its GitHub permalink.
  - BL-418: the existing free-form support/intake 🎟 topic stays exactly as
    it is.
- **The specifier's skills:** the INVEST mint gate
  (`swarmforge/roles/specifier.prompt`) and IR-DRY
  (`bb gherkin-ir-dry-checker`).

**No existing ticket covers this.** Searched the active, paused, done and
archived backlog, and specs, for an intake form/builder/topic/editor,
dropdowns and ubiquitous language.

## Starter vocabulary (seed all of it; the human deletes in the form)

The narrative reads `As <actor>` / `I want to <action>` / `So I can <goal>`.
Values are stored without the template words.

- **Actors:**
  - the human (the one authorised Telegram principal)
  - a phone user
  - a SwarmForge VC user (someone running the swarm on their own repo)
  - the operator (a Claude Code session supervising the swarm)
  - the swarm roles: the specifier, the coder, the cleaner, the architect,
    the hardender (the repo's spelling), the documenter, QA, the
    coordinator, the art director
- **Actions:** file a new intake from my phone · see that an agent has
  accepted my question · chat with a local model about the project · run a
  swarm seat on a local model · approve or reject a pending decision
- **Goals:** know the swarm is working on it · keep the backlog in one
  ubiquitous language · work on the project away from my desk · cut cloud
  token costs · trust that nothing lands without review

The parentheses are glossary text for the dropdown's hint, not part of the
value.

## Slices (mint in this order under one new epic tracker; each INVEST-sized)

### S1 — The Intake topic and its form (no deps)

- A new standing forum topic "Intake": principal-only, with a way into the
  form. It is distinct from the support/intake 🎟 topic.
- The form:
  - three narrative dropdowns over the shared vocabulary, each with "add new…"
    and a Delete per value (with a confirm);
  - one or more scenarios in free text (Given/When/Then, plus And/But);
  - an optional notes field;
  - drafts saved and resumable, several at once, and discardable.
- **Submit** writes `backlog/INTAKE-<slug>-<date>.md` at the backlog root. It
  holds the narrative, scenarios and notes, plus S2's Verify history and S3's
  transcript once those exist. The topic confirms it with the permalink
  (BL-415). New values used by the intake join the shared list at this point.
- Seed the starter vocabulary above.

Draft acceptance:

```gherkin
Scenario: The narrative slots offer the shared vocabulary
  Given the shared vocabulary holds the actor "the human"
  When I open a new draft from the Intake topic
  Then the actor dropdown offers "the human"

Scenario: A value I add stays in my draft until I submit
  Given I add the actor "a night-shift reviewer" to a draft
  When I discard that draft
  Then a new draft's actor dropdown does not offer "a night-shift reviewer"

Scenario: Submitting shares the draft's new values
  Given my draft uses the new goal "sleep through the night"
  When I submit the draft
  Then every later draft's goal dropdown offers "sleep through the night"

Scenario: Deleting a value never rewrites what used it
  Given a submitted intake whose actor is "a phone user"
  When I delete "a phone user" from the actor dropdown
  Then later drafts do not offer "a phone user"
  And the submitted intake still reads "As a phone user"

Scenario: Submit puts the intake in the usual queue
  Given a draft with a narrative and one scenario
  When I press Submit
  Then an INTAKE file holding the narrative and the scenario is at the backlog root
  And the Intake topic confirms it with the file's permalink

Scenario: An unreachable form is said, not a dead button
  Given the tunnel serving the form is down
  When I open the form from the Intake topic
  Then the topic says the form is unreachable and why
```

### S2 — The draft's specifier session and Verify (deps: S1)

- **One specifier session per draft**, run outside the pipeline at any hour.
  It never sends a parcel to, or waits on, the live pipeline specifier seat.
  - It has read-only access to the draft, the vocabulary, the backlog,
    feature files and docs.
  - It writes nothing and commits nothing.
- **Verify** runs INVEST, IR-DRY over the steps, a near-duplicate check of the
  narrative values against the vocabulary, and a duplicate/overlap search of
  the backlog.
- **Results:** each suggestion comes back on its own with Accept/Reject, plus
  Accept all. Nothing is applied without a tap.
- **Staleness:** one Verify per draft at a time. Editing the draft marks the
  last Verify stale.
- The submitted intake carries the Verify history (each suggestion, taken or
  declined), so the draining specifier doesn't repeat that review.

Draft acceptance:

```gherkin
Scenario: Verify's findings come back one by one
  Given a draft whose two scenarios repeat the same Given step
  When I press Verify
  Then each suggestion is listed on its own with Accept and Reject
  And one suggestion names the repeated step

Scenario: Nothing changes without my tap
  Given Verify suggested replacing the actor "operator" with the existing "the operator"
  When I reject that suggestion
  Then my draft still reads "operator"

Scenario: Accept all applies every open suggestion
  Given Verify returned three suggestions
  When I press Accept all
  Then my draft carries all three changes

Scenario: Verify finds an existing ticket
  Given the backlog holds a ticket that already delivers my draft's action
  When I press Verify
  Then a suggestion names that ticket

Scenario: Editing after a Verify makes it stale
  Given a draft that was verified
  When I edit a scenario
  Then the Verify result is marked stale

Scenario: Verify never reaches the pipeline specifier
  Given the day-shift swarm is running
  When I press Verify
  Then no parcel reaches the pipeline specifier seat
```

### S3 — Ask specifier: a talk panel in the form (deps: S2)

- **Transport:** the Let's Talk turn loop as it is, with the same controls and
  engines (tap to talk, tap to send, optional hands-free, hold music, mute),
  plus a text box to type instead of speaking. It is routed to the draft's
  S2 session, so a later Verify knows the conversation.
- **Replies:** short and spoken-style, with the full text on screen.
- **Changes:** any change it wants arrives as an S2 suggestion.
- **Transcript:** it goes into the submitted intake with the Verify history.
- **Cost:** each turn is one Claude call, the same as a Verify press.

Draft acceptance:

```gherkin
Scenario: A spoken question gets a spoken answer about my draft
  Given a draft is open in the form
  When I tap talk, ask "is there already a ticket for this?" and tap again
  Then the specifier's answer is spoken
  And its text is shown under the draft

Scenario: A change it proposes waits for me
  Given the specifier proposes a new scenario while we talk
  Then the proposal is listed as a suggestion with Accept and Reject
  And my draft is unchanged until I accept it

Scenario: Typing works as well as talking
  When I type a question instead of speaking
  Then the specifier answers it the same way

Scenario: Verify knows what we discussed
  Given I talked with the specifier about my draft
  When I press Verify
  Then Verify runs in the same session as that conversation

Scenario: The transcript travels with the intake
  Given I talked with the specifier about my draft
  When I submit it
  Then the INTAKE file holds the conversation transcript
```

## Firm

- Nothing the specifier suggests, from Verify or from talking, reaches the
  draft without the human's tap.
- Verify and Ask never touch the pipeline specifier seat and never wait on a
  shift.
- The specifier session is read-only: no writes, no commits, no shell beyond
  reading.
- Deleting a vocabulary value never rewrites a submitted intake or an open
  draft.
- The Intake topic answers only the principal. The support/intake 🎟 topic
  is unchanged.
- The voice path reuses Let's Talk's loop and engines; no new STT/TTS engine
  in v1.

## Out of scope (v1)

- The Bubble Android app and Telegram voice notes as Ask surfaces.
- Hold-to-talk.
- Scenario Outline/Examples tables.
- Renaming or merging vocabulary values (Delete is in).
- A vocabulary for steps.
