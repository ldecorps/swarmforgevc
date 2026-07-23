# Human directive — give the specifier a real pre-spec clarifying-poll mechanism (URGENT)

**From:** human (via Claude Code coordinator session)
**Date:** 2026-07-23
**Authority:** human-requested, explicitly marked urgent

## Problem

The specifier's own working rule is to question ambiguous new tickets before
speccing them, rather than resolving ambiguity by unilateral judgment call. In
practice it has not been doing much of that recently — and investigation shows
this is a real infrastructure gap, not a compliance lapse. **The human's stated
concern: they do not want the specifier making judgment calls alone on
ambiguous choices it should be surfacing instead.**

Today, if the specifier hits an ambiguous choice while drafting a spec, it has
no wired way to raise a multiple-choice clarifying question and get a real
answer back before proceeding:

- **`operator_ask.bb`** (`swarmforge/scripts/operator_ask.bb`) is the only
  thing that drives the multi-option poll/button rendering (BL-483, shipped —
  `deliverAgentQuestion` in
  `extension/src/tools/telegramFrontDeskBotCore.ts:2741-2753`). It is wired
  **Operator-only**: invoked per `operator.prompt`, tied to a `SUP-###`
  support-ticket thread, enforcing one pending question at a time via
  `awaiting-answer.json`. No other role's `.prompt` — including
  `specifier.prompt` — references it, expects it, or is told how to invoke
  it. `deliverAgentQuestion` posts to a single **shared "agent-questions"
  topic** (`adapters.agentQuestionsTopicId()`), not any per-role topic.
- **The specifier's own dedicated Telegram topic exists** (BL-425, shipped —
  `.swarmforge/operator/role-topic-map.json` maps `"specifier": 1595`) but is
  wired one-way: it carries human-initiated steers INTO the specifier
  (`roleForTopic`/`notifyRoleTopic`), not questions raised OUT of it.
- **`specifier.prompt` itself only says, in prose, to "ask the human to
  resolve ambiguity"** — no concrete tool or command backs that instruction
  today (confirmed: no reference anywhere in `specifier.prompt` to
  `operator_ask.bb`, `SUP-###`, or `awaiting-answer.json`).
- **BL-568** (`backlog/paused/BL-568-menu-blocked-pane-questions-as-mapped-polls.yaml`,
  `needs_design`, assigned to specifier) looks adjacent but is a genuinely
  different, narrower mechanism: auto-detecting a Claude Code interactive
  `AskUserQuestion` menu blocking a pane and converting it to a poll that
  drives keystrokes back in. Its own `out_of_scope` explicitly excludes
  "non-menu question flows (`operator_ask`/`awaiting-answer.json`) — already
  covered by BL-306/BL-466," which is not actually true for the specifier's
  case — this ticket must not be conflated with or folded into BL-568.

## What's wanted

A real, wired way for the specifier — mid-session, on its own initiative,
before finalizing a spec — to raise a multiple-choice (or free-text)
clarifying question, have it render as a tappable poll/buttons (reuse BL-483's
existing rendering), have it land in the specifier's OWN topic (reuse BL-425's
existing per-role topic map, topic `1595`) rather than the shared
agent-questions topic, and have the answer come back into the specifier's own
inbox/session so it can resume drafting with a real decision instead of a
guess.

**Hard requirement, confirmed already load-bearing in BL-483 and must not be
lost in whatever this ticket builds:** the human must be able to answer with
free text when none of the offered options fit, exactly like today's
`operator_ask.bb` polls (`composeAskMessageBody`'s "Or reply with your own
answer." — `extension/src/tools/telegramFrontDeskBotCore.ts:2712-2720` —
and the dedicated scenario at
`specs/features/BL-483-multi-option-ask-buttons.feature` scenario
`multi-option-ask-buttons-03`, both button-tap and typed free-text answers
riding the SAME `postToBridge` answer-effect path). If the design ends up
building a distinct/simpler tool rather than reusing `operator_ask.bb`
directly (see open question below), this free-text fallback must be
reproduced explicitly — it is not something to silently drop for simplicity.

## Open questions for whoever specs this (note: likely NOT the specifier alone,
given the point of this ticket — see below)

- Reuse `operator_ask.bb`'s machinery (options JSON, one-pending-question
  guard) but retarget delivery to the asking role's own topic instead of the
  shared agent-questions topic — or is a distinct, simpler tool warranted
  specifically for non-Operator roles?
- How does the answer get back into the *specifier's own* live session/inbox
  rather than requiring a human to separately relay it (the "manual ferry both
  directions" problem BL-568 was filed over, for a different mechanism, is the
  same failure mode to avoid here)?
- Should this capability generalize to any role that might need mid-session
  clarification (coder, architect, etc.), or is it deliberately specifier-only
  for now given the specific concern raised (unilateral spec judgment calls)?

## Note on process for THIS ticket specifically

Given the human's stated concern is literally "the specifier should not be
making unilateral judgment calls," it would be self-defeating for the
specifier to resolve this ticket's own open questions by unilateral judgment
call. Whoever picks this up should treat the open questions above as requiring
explicit human sign-off before locking the design, not as calls to make
independently — flag this in the ticket's own `approval_context` when drafted.

## Proposed ticket

Drain this intake into a properly-scoped ticket in `backlog/paused/` with a
Gherkin feature under `specs/features/`. Mark **severity: high**, **urgent**
per the human's explicit framing. `human_approval` still required before
promotion.
