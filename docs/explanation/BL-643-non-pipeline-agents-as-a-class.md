# The Non-Pipeline Agents, As a Class

The swarm's pipeline (Article 1 of the constitution) is a chain: specifier,
coder, cleaner, architect, hardener, documenter, QA, with the coordinator
routing and bookkeeping around it. Every one of those seven roles holds a
`BL-###` ticket, moves through a gate, and forwards a parcel.

Alongside that chain, the swarm runs a second, whole category of agents that
are none of those things. They hold no ticket, appear in no pipeline
handoff, and are not bounded by a quality gate — but they are not lesser
roles either: the Operator supervises the swarm from outside it, and the
Expeditor can drive the entire pipeline with the swarm stopped. **Non-pipeline
describes where these agents sit, not how much authority they have.**

Coverage of this category has been uneven for a long time — one agent had 21
files written about it, another had none — and nobody planned the
unevenness. This document names the category and the shape each member
takes; [the reference table](../reference/BL-643-non-pipeline-agents-reference-table.md)
is the checked, load-bearing companion: every launcher, stop path, role
prompt (or its stated absence), log location, and supervising service in it
was resolved against the repo, not recalled.

## Four shapes, plus one that is none of them

- **Conversational** agents hold a discussion with a human and produce no
  code: the **Onboarder**, **Support**, and the **Front Desk Operator**
  (Concierge) all fit here — each is a disposable, per-event LLM turn that
  exists to talk, not to build.
- **Supervisory** agents watch the swarm rather than talk to a human: the
  **Operator** (the external supervisor, woken by events) and the
  **Babysitter** (a deterministic, non-LLM health-sweep daemon) both sit in
  this shape.
- **Transport** agents move bytes between the swarm and somewhere else, and
  hold no opinion about swarm health or ticket content: **Front Desk** (the
  Telegram bridge + bot), **Negotiation Relay** (one per onboarded target,
  polling for a human's reply to a proposal), **Resident Spy Tunnel** (a
  Cloudflare Tunnel exposing the bridge's Mini App), and **Cursor Bridge**
  (the Telegram ↔ Cursor SDK remote-control bridge) are all this shape —
  structurally close enough to each other that Cursor Bridge is best read as
  the Cursor-SDK analogue of Front Desk's bridge half.
- **Model Steward** does not cleanly fit any of the three shapes above: it
  is a registry (models, capabilities, role-recommendation matrix, prompt
  adapters) accessed synchronously through a CLI, not a standing agent at
  all today — see [the reference table's irregular-case note](../reference/BL-643-non-pipeline-agents-reference-table.md#model-steward--a-role-prompt-with-no-launcher)
  for why it still earns a row.
- The **Expeditor is none of the above** — it is a driver that *wears* the
  pipeline's own hats (coder, cleaner, architect, hardener, documenter, QA)
  in turn, with the entire standing swarm stopped, rather than being a
  launched process itself. See
  [the Expeditor, linked not restated](#the-expeditor-linked-not-restated)
  below.

## The Onboarder: what shipped

The Onboarder guides a human through bringing the swarm to a new target
repo, in a standing Telegram topic. Only **slice 1** (BL-590) is on `main`
today; what follows describes exactly that slice, nothing more:

- **One standing "Onboarding" topic**, ensured once per swarm's Telegram
  group and reused across every target — never one topic per target
  (`ensureOnboardingTopic` in `telegram-front-desk-bot.ts`).
- **A thin poll-loop process.** `launch_onboarder.sh` runs
  `onboarder_supervisor.bb`, which runs `onboarder-reconcile.js` — but that
  process only re-ensures the topic exists and writes a liveness heartbeat
  every 60 seconds. The actual message handling and state-machine
  advancement run inside the Front Desk bot's own single Telegram poller
  (`telegramFrontDeskBotCore.ts`), deliberately avoiding a second
  `getUpdates` poller against the same bot token (a 409-conflict risk BL-439
  already documented). A table entry that credited the poll-loop process
  with the state-machine logic would be describing where the code is *not*.
- **A five-step prerequisites state machine, per target**
  (`extension/src/onboarding/onboarderState.ts`): `toolchain`,
  `github-access`, `fork-clone`, `target-repo`, `bot-token`, each requiring a
  pasted verification the code actually checks — a bare "done"/"yes"/"ready"
  claim is explicitly rejected (`isBareDoneClaim`).
- **Per-target state persisted to disk**, one JSON file per target under
  the swarm repo's `.swarmforge/onboarding/`, keyed by a hash of the
  normalized target repo URL (`slugifyTargetRepoUrl`) so URL variants
  (scheme, `.git` suffix, trailing slash) of the same target resolve to the
  same in-flight onboarding.
- **Pause, resume, and restart-resume.** A human can send `pause`/`proceed`
  in the topic; because the state above is disk-persisted rather than
  in-memory, it survives both a manual pause and a process or daemon
  restart.

**Not built yet:** survey, gate, prompt generation, and launch-handoff
behaviour are all later phases, owned by BL-624 (survey-to-gate) and BL-625
(prompts and launch-handoff) — both specced and approved, both still in
`backlog/paused/`, neither built. A document that described them as present
would be worse than one that said nothing, because a reader could not tell
which half was real. The Onboarder has no authored role prompt of its own
(`swarmforge/roles/onboarder.prompt` does not exist) — everything above is
derived from reading the shipped code, not from an authored description, and
is stated that way rather than left for the reader to assume.

## The Expeditor, linked not restated

The Expeditor already has a complete, dedicated set of docs. Restating them
here would create a second description of the same behaviour that could
drift from the first — so this document links them instead:

- [How to drive one ticket through every gate with the swarm stopped](../how-to/BL-567-expedite-one-ticket-with-the-swarm-stopped.md)
- [Why the expeditor commands the stack but never depends on it](BL-567-why-the-expeditor-commands-the-stack-but-never-depends-on-it.md)
- [Expeditor — complete reference](../reference/BL-567-expeditor-manual.md)

In one sentence, for the taxonomy above: the Expeditor reads only durable
data under git and never depends on the handoff daemon, mailboxes, tmux, or
rotation — though it does stop and restart them — which is why it belongs
in its own category rather than "supervisory" or "transport."

## What this document does not cover

- Retiring the Babysitter is BL-611's decision, not this document's; the
  reference table describes whatever state it is in today.
- The naming question this ticket was originally filed alongside — what to
  call the guided-onboarding agent — is closed. The human ruled
  **Onboarder** on 2026-07-26, BL-684 shipped the rename with its own
  permanent regression gate, and that gate is not restated here.
- Role prompts for the agents that lack one (Front Desk, Front Desk
  Operator, Negotiation Relay, Resident Spy Tunnel, Onboarder, Babysitter,
  Cursor Bridge) are not written here — worth their own ticket if a future
  reader decides one is needed.
