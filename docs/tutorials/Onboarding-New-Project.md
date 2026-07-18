# Onboarding a New Project — and the Acceptance Contract

This guide is for plugging SwarmForge into a **new or greenfield** target
project. For installing and running the SwarmForge VC extension itself, see
[Getting Started](GettingStarted.md) first — this guide picks up from "point
it at a target" and focuses on what actually drives the swarm's work: **the
acceptance contract**.

## 1. Onboarding mechanics (reuse, don't re-derive)

The mechanical steps — install the extension, set the target, launch, watch,
get a PR — are already covered in [Getting Started](GettingStarted.md); this
guide does not repeat them. Two things specific to a brand-new target are
worth calling out:

- **Initialize Target** (`swarmforge.initializeTarget`) scaffolds and commits
  `project.prompt` and `engineering.prompt` into the target repo, so they
  travel with it when the swarm clones/works it. These carry the target
  project's own goals and engineering conventions — see `project.prompt` and
  `local-engineering.prompt` in this repo for the shape they take here.
- If the target directory is not already a git repository, SwarmForge
  initializes one and makes the first commit at startup (README, startup
  step 5) — a brand-new project does not need to be a git repo beforehand.
- **Initialize Target**'s scaffold is generic placeholder text
  (`<what this project does and why>`-style angle brackets). Section 2 below
  (BL-269) generates SURVEY-POPULATED content for these same two files as
  part of the onboarding contract negotiation — whichever runs first for a
  given target wins that file (existence-only idempotency), so running the
  onboarding survey/negotiation before or instead of a bare `Initialize
  Target` gets you real content immediately rather than blanks to fill in.

## 2. The onboarding scope contract (survey → propose → agree)

Before any build work dispatches for a target at all, the swarm and the
operator settle a separate, higher-level **onboarding contract** — the
overall mandate for what the swarm will (and will not) do on this repo. This
is new as of BL-262 and sits *above* the per-ticket acceptance contract
described in section 3 below: agreeing the onboarding contract doesn't
replace or skip per-ticket `human_approval` — every feature draft still gets
its own sign-off — it just gates whether *any* ticket can start at all.

- **Survey.** An onboarding agent reads the target repo's own code and
  structure (languages, layout, README) plus any seed vision and initial
  backlog, and gathers that into a `RepoSurveyFacts` fixture (the survey
  itself is swarm/agent behavior; everything downstream of it is a pure
  function fed that fixture).
- **Propose.** `proposeContractFromSurvey`
  (`extension/src/onboarding/contractSurvey.ts`) maps those facts into a
  `ProposedContract` — scope, out-of-scope, boundaries, and an initial-backlog
  summary all populated from the survey (never a blank template) — marked
  `agreement: proposed`. `node extension/out/tools/propose-onboarding-contract.js
  <target-repo-path> <survey-facts-json-path>` runs this and scaffolds +
  commits the result into the target repo via `initializeTargetContract`
  (`extension/src/config/targetBootstrap.ts`, reusing the same idempotent
  plan/write/commit seam `initializeTargetRepo` already uses for
  `project.prompt`/`engineering.prompt`).
- **Hybrid artifact.** The contract is git-tracked in the *target* repo, not
  machine-local state: `.swarmforge/contract.yaml` is the structured source
  the gate parses, and a generated `CONTRACT.md` is a legible view for the
  target's humans, rendered from that same source
  (`generateContractMarkdown`/`renderContractYaml` in
  `extension/src/onboarding/contractView.ts`) so the two can never diverge.
- **Use-case inventory (BL-360).** The same survey also answers a different
  question than the contract: not "where are the edges" but "what does this
  application actually DO today, feature by feature" — what you need in order
  to change it, not just to agree a mandate. `deriveUseCaseInventory`
  (`extension/src/onboarding/useCaseInventory.ts`) is a third pure derivation
  of the identical `RepoSurveyFacts` the contract and prompts already consume
  (never a second survey pass), rendered to a legible `USE-CASES.md` at the
  target repo root, beside `CONTRACT.md` — each entry names a capability, a
  one-line summary, and where in the target's own code it lives, so a later
  change request can cite it by name. Unlike the generated
  `project.prompt`/`engineering.prompt` below, this file is **never gated on
  agreement**: it is written via `initializeTargetUseCaseInventory`
  (`extension/src/config/targetBootstrap.ts`), the same ungated path as
  `CONTRACT.md` itself, because the human needs it in order to *decide* on the
  contract, not after. A target whose code supports no discernible use case
  still gets a `USE-CASES.md` that says so plainly, rather than no file at all.
- **Agree.** The operator reviews `CONTRACT.md` (or the yaml directly) and
  flips `.swarmforge/contract.yaml`'s `agreement` field from `proposed` to
  `agreed` once satisfied. To re-open scope later, flip it back to `pending`
  and re-negotiate — the gate re-holds automatically.
- **Gate.** Before promoting a paused ticket into `backlog/active/`, the
  coordinator runs `node extension/out/tools/onboarding-contract-gate.js
  <target-repo-path>` (`swarmforge/roles/coordinator.prompt`'s Onboarding
  Contract Gate section). The gate is **fail-closed**
  (`evaluateBuildStartGate`, `extension/src/onboarding/buildStartGate.ts`):
  only an `agreed` contract allows dispatch. A missing, malformed, `proposed`,
  or `pending` contract all hold, each with a reason naming why — a target
  with no contract yet simply reads as `missing` (hold), so it must be
  surveyed and proposed before any ticket for it can start.

This ships as slice 1 (survey → propose → a single agree/hold decision).

**The negotiation loop (BL-344).** A single proposal is not a negotiation —
the operator can push back, in his own words, and the swarm revises IN
RESPONSE rather than re-emitting the same proposal:

```
node extension/out/tools/negotiate-onboarding-contract.js <target-repo-path> object "<objection text>"
node extension/out/tools/negotiate-onboarding-contract.js <target-repo-path> approve
```

- **`object`** revises the committed contract against the operator's own
  words (`reviseContractFromObjection`,
  `extension/src/onboarding/contractNegotiation.ts`): "remove/exclude X"
  moves a matching scope entry to out-of-scope, "add/include X" adds a new
  scope entry carrying the operator's own text, and anything else is
  recorded as a new boundary — the objection is always reflected somewhere,
  never silently dropped. Each round is appended as a durable record
  (`{round, objection, changedFields}`) to
  `.swarmforge/onboarding-negotiation.jsonl` in the target repo.
- **`approve`** flips `.swarmforge/contract.yaml`'s `agreement` field to
  `agreed` and commits — the same effect as the hand-edit described above,
  now also reachable as a command.
- The loop is bounded at `DEFAULT_MAX_NEGOTIATION_ROUNDS` (5): an objection
  attempted after the budget is exhausted is refused and ends the
  negotiation without approving anything. Approval remains valid at any
  point up to and including immediately after the last round in budget.
- The build-start gate is unchanged: a revision is still just
  `agreement: proposed`, so the gate holds through every round exactly as
  it does for the single-round case, and only an actual `approve` releases
  it.

**The same negotiation also generates `project.prompt`/`engineering.prompt`
(BL-269, a child slice of this family).** `proposePromptsFromSurvey`
(`extension/src/onboarding/promptProposal.ts`) maps the identical
`RepoSurveyFacts` used above into survey-populated `project.prompt` and
`engineering.prompt` content — real prose, not section 1's generic
placeholder template. These two files ride the *same* agreement marker as
the contract (one agreement, whole artifact set): `node
extension/out/tools/propose-onboarding-prompts.js <target-repo-path>
<survey-facts-json-path>` is safe to re-run at any point — while the
contract is `proposed`/`pending` it's a no-op (`withheld: true`, nothing
written), and only once the contract is `agreed` does the same command
actually write and commit both files into the target repo. Re-running it
after the operator flips `agreement` to `agreed` is what releases them.

**Verbosity is a negotiated contract term too (BL-382).** How chatty the
agents should be — precise and long, or terse — is not fixed; it rides the
same `.swarmforge/contract.yaml` as scope and boundaries. `ProposedContract`
carries an optional `verbosity` field restricted to a closed set —
`concise` / `normal` / `detailed` (`VERBOSITY_LEVELS`,
`extension/src/onboarding/contractTypes.ts`) — never free text, so a typo or
an out-of-band value can't splice arbitrary instructions into a generated
prompt. `proposePromptsFromSurvey` (`extension/src/onboarding/promptProposal.ts`)
resolves the contract's negotiated term via `resolveVerbosity` and appends an
explicit "Be `<verbosity>` in your responses and explanations." instruction to
both generated `project.prompt` and `engineering.prompt`. An offered value
outside the closed set is refused outright rather than silently accepted; a
contract that never mentions verbosity at all — every contract negotiated
before this term existed, including this repo's own agreed `CONTRACT.md` —
defaults to `normal` rather than crashing or leaving a blank instruction.
Change your mind later the same way as any other contract term: object,
revise, re-approve, and re-run the prompt-proposal command above.

The same verbosity also governs the front desk's own Telegram replies to
you, not just the generated agent prompts (BL-383) — that's the messages
you actually read. The front-desk Operator re-reads the target's
`contract.yaml` on every reply, so a re-negotiated verbosity takes effect
immediately on the very next reply, with no swarm restart needed.

**Each target gets its own Telegram bot and group to negotiate the contract in
(BL-380).** Two targets can never share one Telegram bot: `getUpdates` is
long-polling scoped to the bot token, so a second concurrent poller on the
same token gets `409 Conflict`, and the update offset that acknowledges
messages is per-token and global across chats — whichever process polls first
silently consumes the update, so the *other* target never sees a message
meant for it. Provisioning one bot per onboarded target makes the isolation
structural rather than a chat-id filter layered on top.

The Bot API has no create-bot or create-group/enable-topics method, so one
manual step per target is irreducible:

```
node extension/out/tools/provision-onboarding-telegram-channel.js <target-repo-path> <bot-token> <bot-username> <host-secrets-file-path> <swarm-name> [bridge-port]
```

`<swarm-name>` is this swarm's own identity (`primary` for the default
single-swarm setup) - a successful run also writes
`~/.swarmforge/fleet/<swarm-name>/telegram.json`, which
`front_desk_supervisor.bb` resolves its bot token/chat id/bridge port from
at launch, keyed by swarm rather than by whatever shell launched it.
`[bridge-port]` defaults to `8765` when omitted.

Run it and it prints the exact steps plus a `t.me/<bot>?startgroup=true`
add-to-group link:

1. Message [@BotFather](https://t.me/BotFather) and run `/newbot` to create
   this target's own bot — note the token it hands you.
2. Create a new Telegram group for this target repo.
3. Open the group's settings and enable **Topics**, so it becomes a
   forum-enabled supergroup.
4. Add the bot to the group as an admin via the printed link.

You are never asked to paste a chat id. Because the bot is brand new and
scoped to this one target, the first chat its own `getUpdates` reports back
*is* the target's group — the command detects it and opens a "Contract
negotiation" topic there automatically. A half-finished setup (bot created
but not yet added to a Topics-enabled group) reports not-ready rather than
opening a topic, and re-running the same command once setup is finished picks
up where it left off. If the printed result instead carries an `error` field,
the problem isn't the group/Topics/admin setup — it's the bot token itself
(mistyped, revoked, or a network/rate-limit failure talking to Telegram);
double-check the token you pasted from BotFather and re-run. The bot token is
stored host-side (outside the target's
working directory and never committed, one entry per target so a second
target's token can never collide with the first's); the group's chat id and
negotiation topic id are the only things persisted into the target's own
`.swarmforge/operator/telegram-channel.json`.

**The negotiation itself can run in that topic instead of the CLI (BL-381).**
BL-380 above only provisions the channel and topic; this is the wiring that
actually carries the back-and-forth over Telegram, reusing the same
negotiation rounds and durable log as the CLI form above — never a second
negotiation engine:

```
node extension/out/tools/relay-onboarding-negotiation-telegram.js <target-repo-path> <host-secrets-file-path> post-proposal
node extension/out/tools/relay-onboarding-negotiation-telegram.js <target-repo-path> <host-secrets-file-path> poll
```

- **`post-proposal`** posts the current `.swarmforge/contract.yaml` into the
  negotiation topic as a plain-text summary (scope / out-of-scope /
  boundaries) with instructions to reply in the topic to object, or reply
  "agree" to approve. Idempotent like BL-380's own provisioning step: running
  it again after a successful post is a no-op. **It now also starts the live
  poll trigger for you** (see below) — nothing further to run by hand.
- **`poll`** reads one batch of updates from that topic. A reply that is
  exactly "agree"/"agreed"/"approve"/"approved"/"lgtm"/"yes" (whole reply,
  not a substring — "I agree with most of this but remove the PWA work" is
  read as an objection, not approval) flips the contract to `agreed` the
  same way `negotiate-onboarding-contract.js approve` does, which is what
  releases the build-start gate. Anything else non-empty is fed to the same
  `object` round the CLI uses, and the revised contract is posted back into
  the topic. Only messages from the target's own chat, its negotiation
  topic, and the one authorized human (`TELEGRAM_PRINCIPAL_USER_ID`, the
  BL-379 guard) are ever acted on — everything else is silently dropped.
  `poll` requires that env var; `post-proposal` does not.
- Each round is appended to the same `.swarmforge/onboarding-negotiation.jsonl`
  the CLI form writes, so the negotiation survives a restart regardless of
  which form carried a given round. The relay's own poll cursor is persisted
  separately (`.swarmforge/operator/negotiation-relay-offset.json`) so a
  restarted relay never re-applies an already-handled reply as a duplicate
  round.
- The bot token is read from the same host-side secrets file BL-380's
  provisioning step wrote it into — never taken as a CLI argument, so it
  never leaks via `ps`.

**`poll` runs live, supervised, with no manual step (BL-381 follow-up fixes).**
A one-shot `poll` only checks the topic once, and nothing in a running swarm
ever called it repeatedly — a human's reply was invisible until someone
happened to run the CLI again by hand. Two fixes closed that gap:

- A `poll-loop` action runs `poll` forever, paced by Telegram's own
  long-poll and writing a heartbeat each cycle. `negotiation_relay_supervisor.bb`
  supervises it per target — spawn, crash-detect, bounded restart,
  heartbeat-stall detection, give-up escalation — reusing
  `front_desk_supervisor.bb`'s own state machine rather than a second
  implementation. `swarmforge/scripts/launch_negotiation_relay.sh
  <target-repo-path> <host-secrets-file-path>` starts it (requires
  `TELEGRAM_PRINCIPAL_USER_ID`; supports `NEGOTIATION_RELAY_LAUNCH_DRYRUN=1`
  to print the assembled command without starting anything).
- That launcher still had to be run by hand as a third manual step after
  `post-proposal`. `post-proposal` now spawns it automatically (detached,
  via an injectable `LaunchRelaySupervisorFn`) the moment the proposal is
  posted — the first moment a human could reply — so nothing further is
  needed once the target's channel is provisioned and the proposal sent. A
  target repo under the system temp dir never triggers a real spawn
  regardless (a test-fixture safety net), and `poll-loop`/`poll` both stay
  directly runnable for manual recovery.

## 3. The acceptance contract

This is the part the operator asked about specifically.

### What it is

The **acceptance contract** is SwarmForge's mechanism for saying WHAT the
swarm should build, in a form that is both human-reviewable and
machine-executable:

- The specifier expresses each work item's acceptance criteria as **Gherkin
  scenarios** (Given/When/Then), saved into a `.feature` file under
  `specs/features/`. Per `swarmforge/roles/specifier.prompt`, these scenarios
  **are** the contract the coder implements against.
- Since BL-111, feature files are the **durable** contract — they outlive the
  backlog ticket that created them (`specs/features/*.feature` "are the
  acceptance contract and outlive the backlog item," per the shared
  engineering article). A ticket can be closed and archived; its feature file
  stays in the tree as the living record of what that behavior contractually
  does.
- Each backlog ticket's YAML carries an `acceptance:` field that is a path
  reference to its feature file (`acceptance:
  specs/features/<ticket-id>-<slug>.feature`), not inline Gherkin. This is
  the link between "what was asked for" (the ticket) and "what must remain
  true" (the feature file).
- **QA gates on it.** The final pipeline stage runs the acceptance suite and
  requires every scenario in the ticket's referenced feature file to pass
  (N/N) before the work is approved. The contract isn't aspirational — it's
  the actual pass/fail bar the swarm is held to.

> **Not to be confused with:** two other things in this project also use the
> word "contract." Section 2 above describes the **onboarding scope
> contract** — a project-level, survey-and-agree mandate gating whether any
> ticket can start at all; this section's acceptance contract is a *separate*,
> per-ticket thing that still applies underneath it. This repo's README also
> uses "contract" for something unrelated again — the small shell-function
> contract (`terminal_backend_label`, `terminal_backend_can_open_sessions`,
> etc.) a terminal backend adapter must implement (README, "Adding A Terminal
> Backend"), an internal plumbing contract for terminal automation with
> nothing to do with either of the above.

### How a new project gets its first contract

1. **Intake.** A request lands as a raw item in `backlog/` (the intake root)
   or is described directly to the specifier.
2. **Specifier writes the spec.** The specifier turns the request into a
   prose `description:` (what/why/constraints) plus Gherkin `acceptance:`
   scenarios, following the format in `swarmforge/roles/specifier.prompt`
   (one scenario per distinct observable behavior; shared `Given` setup moved
   into a `Background:`).
3. **Feature file + lint.** The scenarios are saved to a new
   `specs/features/<ticket-id>-<slug>.feature`, and the specifier runs
   `swarmforge/scripts/gherkin_lint_gate.sh <feature-file>` before ever
   handing the ticket off — a parcel never proceeds behind a feature file the
   gate rejects. The gate enforces two rules:
   - **No wrapped steps**: A step must fit on a single physical line. The embedded
     gherkin parser silently truncates any step that wraps to a second line,
     dropping text after the line break. The gate scans raw feature text and rejects
     any continuation line inside a Scenario/Scenario Outline/Background body.
   - **No phantom Examples columns**: In a Scenario Outline, every Examples column
     name must appear as a `<token>` in at least one step's step text (matching
     the same substitution rules as the runtime — not the parser's narrower field
     inspection). The gate flags Examples columns that never appear as tokens,
     indicating a mismatch between the test data and the steps it feeds.
   - **Grandfathered violations**: Pre-existing wrapped steps in 19 already-landed
     feature files are listed in `swarmforge/scripts/gherkin_lint_gate_legacy_wraps.txt`
     and are exempt from the wrap check only. New and changed feature files enforce
     both rules unconditionally. The legacy list is not a dumping ground — follow-up
     tickets rewrap those files and remove them from the list one at a time.
4. **Human approval gate.** A freshly drafted or changed feature file is not
   treated as final until a human has reviewed it. Tickets carry this
   explicitly, e.g. a trailing `# HUMAN APPROVAL: ...` comment and/or a
   `human_approval: pending`/`approved` field in the ticket YAML — the swarm
   does not silently treat its own draft as authoritative.
5. **Build-then-promote discipline for sliced work.** When a deliverable
   ships in slices, the *live* feature file must contain only scenarios for
   slices that are actually **built** — the acceptance runner throws on any
   scenario lacking a step handler, hard-failing the gate. Scenarios for
   not-yet-built slices are parked in a non-executable companion file (a
   `<slug>.feature.draft`, which no `*.feature` glob or the runner picks up),
   preserving the up-front design without breaking the gate. Each slice's
   scenarios move from the draft into the live feature file only once that
   slice is implemented.
6. **Ticket promotion.** The specifier writes new tickets into
   `backlog/paused/` — writing a spec does not start work. The coordinator
   promotes a paused ticket into `backlog/active/` (respecting the
   configured depth cap) when a slot is open, and that's when the pipeline
   actually begins building against the contract.

### A concrete minimal example

`backlog/done/BL-249-pwa-sw-cache-name-content-derived.yaml` and its feature
file `specs/features/BL-249-pwa-sw-cache-name-content-derived.feature` show
the linkage end to end:

- The ticket YAML's `acceptance:` field points directly at the feature file:
  `acceptance: specs/features/BL-249-pwa-sw-cache-name-content-derived.feature`.
- The feature file opens with a comment block naming the bug/behavior, a
  `Background:` shared by all scenarios, and one `Scenario:` per distinct
  observable behavior (e.g. "a deploy that changes the shell delivers the
  update to a returning user"), each preceded by a stable comment name
  (`# BL-249 shell-change-reaches-users-01`) per the specifier's naming
  convention.
- The ticket's trailing `# HUMAN APPROVAL: ...` comment records that this was
  a new specifier-drafted feature file pending human review before being
  treated as authoritative.

For a slice-scoped example (draft-then-promote in practice), compare a
ticket's live `.feature` file against its sibling `.feature.draft` — e.g.
`specs/features/BL-235-per-tile-backend-model-switch.cross-backend.feature.draft`
alongside `BL-235-per-tile-backend-model-switch.feature` — to see scenarios
for a not-yet-built slice parked outside the executable glob.

## 4. Seeding a fresh project's initial contracts

For a genuinely new target with no backlog yet, the human's inputs enter the
same way any request does: drop a raw description into the target's
`backlog/` root (or describe it directly). The specifier drains the backlog
root first (before touching anything already in `paused/`/`active/`), turns
each raw item into a proper spec with its own feature file as described
above, and writes the result to `backlog/paused/`. From there, normal
coordinator promotion takes over. There is no separate "first contract"
ceremony — the first ticket for a new project goes through exactly this same
intake → spec → feature-file → human-approval → promotion flow as every
ticket after it.

---

For the full pipeline stage-by-stage breakdown, the handoff protocol, and the
product roadmap beyond onboarding, see [Specification.MD](../reference/Specification.MD).
