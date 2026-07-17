# Intake: consolidate Telegram forum topics — fold per-ticket topics into their epic's topic

Filed by the Operator (2026-07-17T08:42:09Z) — a directive came in from the human
operator (via the operator console) that is a new feature, not a desk call. This is
a RAW ask, not a spec: the specifier drains this like any other backlog-root item and
decides what (if anything) becomes a real ticket (or an epic).

## The ask

Reduce how many Telegram forum topics the swarm creates. The concierge currently mints
a brand-new topic **per backlog ticket** (`"BL-### - Title"`), which proliferates into
hundreds of topics. The human wants topic count bounded to roughly the number of *kinds*
of topics, not the number of items.

Concretely, the human's decision:

- **One topic per EPIC.** A ticket that belongs to an epic no longer gets its own
  topic — its swarm events post as **messages into that epic's topic** (prefixed with
  the ticket id).
- **Epic-less tickets** (the majority — `epic: ""`) post as messages into **one standing
  "Backlog" topic** (a new catch-all standing topic), again prefixed with the ticket id.
- **Keep the 8 per-role STEERING topics as-is** — the human explicitly wants those left
  alone (they are a legitimate one-per-kind already).
- All other standing topics stay one-per-kind (Concierge, Approvals, Recert, Agent
  Questions, Control, Pipeline Board, Contract negotiation).

Net effect: instead of `#epics + #tickets` topics, we have `#epics + 1 Backlog topic`
for all product work, plus the existing standing/role topics.

## Operator-gathered facts (context, not a spec)

All topic creation flows through ONE primitive: `createForumTopic` in
`extension/src/notify/telegramClient.ts:441`. "Reducing topics" = changing which callers
fire it. The proliferating callers are:

- **Per-ticket topic** — created at `extension/src/concierge/topicRouter.ts:435`
  (`routeTaggedOrUntaggedEvent` → `adapters.createTopic(action.topicName)`), name built
  by `topicNameForItem(backlogId, title)` = `"BL-### - Title"` (`topicRouter.ts:22`).
  Decision helper is `decideTopicAction` (`topicRouter.ts` ~248). This is the call to
  eliminate for the common path.
- **Per-ticket icon-only path** — `ensurePerTicketTopicForIcon` at `topicRouter.ts:390`.
  This exists ONLY so an `ApprovalRequested` on a ticket that has no topic still gets a
  per-ticket topic to hang its 👀 awaiting-approval icon on (the ask TEXT already posts to
  the standing Approvals topic, BL-424). With no per-ticket topic this path must change —
  see design notes.
- **Per-epic topic** — already exists: created at
  `extension/src/concierge/conciergeTick.ts:743` (`postEpicAction` →
  `routeAdapters.createTopic`), name `"EPIC — Title"` via `decideEpicTopicAction`
  (`topicRouter.ts` ~259). This is the topic that per-epic tickets fold INTO. This code is
  the model to extend; it already posts epic progress updates as messages into the epic
  topic (`epicUpdateText`, `conciergeTick.ts:711`).

Epic linkage is a first-class field, never inferred from prose:
`BacklogItem.epic` (`backlogReader.ts`), read at `conciergeTick.ts:402/405/618`. A ticket
belongs to an epic iff its `epic:` field is a non-empty id (e.g.
`BL-435 → epic: fleet-second-swarm`). Most tickets today have `epic: ""` → those are the
"Backlog" catch-all population.

Topic-id persistence (get-or-create dedup) — read map → reuse id if present, else create,
then write:
- `.swarmforge/operator/backlog-topic-map.json` (`backlogTopicMapStore.ts`) — currently
  keyed by BOTH ticket id AND epic id → topicId. After this change, per-ticket keys stop
  being written (or are repurposed); epic keys stay, plus one reserved "BACKLOG" key.
- Standing topics live in `telegram-topic-map.json` keyed by reserved subject-id constants
  in `extension/src/tools/telegramFrontDeskBotCore.ts` (OPERATOR/APPROVALS/RECERT/
  AGENT_QUESTIONS/CONTROL). A new standing "Backlog" topic would follow the same pattern:
  add `BACKLOG_SUBJECT_ID`/`BACKLOG_TOPIC_NAME` constants + an `ensureBacklogTopic` helper
  called once at boot alongside the others in `telegram-front-desk-bot.ts` (~451-557).

Icons: per-ticket state was carried by the TOPIC ICON (`ICON_EMOJI` in
`extension/src/concierge/topicIcon.ts:29` — done ✅ / defect 🦠 / feature 🎵 / paused 🔍 /
awaiting-approval 👀). A ticket that no longer owns a topic can't own an icon — see design
notes for where state goes. Epic icons (`epicIcon.ts` `EPIC_ICON_POOL`) are unaffected.

## Design/risk notes for the specifier + architect (their call, not mine)

- **Where does per-ticket STATE go now?** Today the ticket's lifecycle state is the topic's
  ICON. Folded into an epic/Backlog topic, each ticket event is just a message — so state
  must live in the MESSAGE (a status prefix/line, e.g. `BL-### ✅ done` / `👀 awaiting
  approval`), and ideally edited-in-place rather than appended (there's already an
  `editInPlaceMessageSync.ts` consumer to model on). Specifier decides the message format
  and whether prior ticket messages get edited or a new one appended per transition.
- **The icon-only approval path** (`topicRouter.ts:390`) loses its reason to exist once
  there's no per-ticket topic. The 👀 awaiting-approval signal must attach elsewhere — most
  likely the ticket's status line inside its epic/Backlog topic, OR nothing extra since the
  ask already renders in the standing Approvals topic (BL-424). Specifier picks; do NOT keep
  minting a throwaway topic just for an icon.
- **Epic-less → Backlog topic** must be a real standing topic ensured once at boot (same
  reuse-or-create + reserved-subject-id pattern as Approvals/Recert), not a per-run topic.
  Reserve one map key so it's idempotent across restarts.
- **Migration of live state:** existing per-ticket topics already exist in the real Telegram
  group and in `backlog-topic-map.json`. Decide what happens to them — leave the old topics
  orphaned/closed, or a one-time reconcile. Don't assume a clean slate; the map is
  machine-local and gitignored under `.swarmforge/`.
- **Topic recreation / restore** (`extension/src/concierge/topicRecreation.ts:79`,
  `recreate-bl-topic.ts`) is a repair path for a DELETED ticket topic. With no per-ticket
  topics it becomes recreate-the-EPIC-topic (or Backlog topic); update or retire it so it
  doesn't resurrect the old per-ticket model.
- **Out of scope (keep as-is):** the 8 per-role STEERING topics (`ensureRoleTopics`,
  `telegram-front-desk-bot.ts:711`) and every other standing topic. This ticket only
  collapses per-ticket product topics into epic/Backlog topics.
- **Overlap watch:** touches the same standing-topic surface as the BL-434/450/452/424/449
  cluster (Approvals roster, Recert posting, Pipeline Board, per-ticket icon). Sequence
  against in-flight work on `topicRouter.ts` / `conciergeTick.ts` / `telegram-front-desk-bot.ts`
  — these are hot shared files. Likely an EPIC in its own right (message-format slice +
  Backlog-topic-ensure slice + per-ticket-topic-removal slice + migration slice), not a
  single ticket.
