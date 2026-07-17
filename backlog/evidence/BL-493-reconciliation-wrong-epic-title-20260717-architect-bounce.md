# BL-493 architect review — 20260717

## Verdict: BOUNCE to coder — reconciliation creates an epic topic named after the epic's raw id, not its title

## What was reviewed

Merged cleaner's `fca8e7e77d` (coder `bf90fb9b86`, cleaner `fca8e7e7`) into
the architect worktree (merge commit `d66ee62887`). Ran a full compile
(clean) and the two required hard gates scoped to every changed file
(`conciergeTick.ts`, `ticketMessageMapStore.ts`, `ticketStatusMessage.ts`,
`topicDeletion.ts`, `topicReconciliation.ts`, `topicRouter.ts`,
`telegram-front-desk-bot.ts`):

- `dependency-gate.js` — PASSED, no forbidden edges.
- `co-change-report.js` — all reported coupling is within the expected
  concierge/topic-routing cluster (the module's own tests, sibling
  `topicRouter.ts`/`pipelineBoard*.ts`/`topicIcon.ts`, and their step
  files); no cross-boundary coupling.

Architecturally the new edit-in-place ticket-status mechanism is clean: the
two pure "testable seam" modules the ticket's own spec calls for
(`ticketStatusMessage.ts`'s target resolver + status-text builder,
`ticketMessageMapStore.ts`'s message-identity store) are genuinely pure and
unit-tested, `syncEditInPlaceMessage` is reused rather than reinvented, the
per-ticket-topic machinery (`ensurePerTicketTopicForIcon`,
`routeTaggedOrUntaggedEvent`, `routeCompletionEvent`) is fully removed, and
`conciergeTick.ts`'s reordering of `postEpicUpdateIfApplicable` ahead of
ticket-status routing is correctly justified (it keeps epic-topic-creation's
icon-setting on one path). The two-layer boundary, I/O ownership, and
webview-storage rules are untouched by this parcel.

## The defect

`topicReconciliation.ts`'s `reconcileTopicLifecycle` builds its
`TicketRouteContext` as:

```ts
const ticketContext: TicketRouteContext = { epic: ticket.epic, epicTitle: ticket.epic, iconState: 'done' };
```

`epicTitle` is set to `ticket.epic` — the epic's raw **id** (e.g.
`topic-consolidation`, `dynamic-routing`), never its human **title** (e.g.
BL-491's own title, `"EPIC — consolidate Telegram forum topics: fold
per-ticket topics into one topic per epic + one standing Backlog topic;
tracks children, do not promote directly"`). `BacklogFolderItem.epic` is
documented in this same file's neighbour (`conciergeTick.ts`, BL-341) as
"read straight off `BacklogItem.epic`... never inferred from notes: prose"
— it is only ever the id string; the title lives on a separate
epic-defining ticket and is resolved via `epicDefinitionsFor`/
`EpicDefinition.title`, which `topicReconciliation.ts` never has access to
(`ReconcileAdapters` carries no epic-definitions lookup at all).

The live-tick path gets this right: `conciergeTick.ts`'s own
`ticketRouteContextFor` (added by this same ticket) resolves
`epicTitleFor(epic, epicDefinitions)`, looking the title up in
`epicDefinitionsFor(folders)` and falling back to the id only when the epic
is genuinely undocumented. The reconciliation path skips that lookup
entirely and always uses the id — even when the epic has a real title.

This surfaces the moment `ensureEpicTopicId` (`topicRouter.ts`) has to
**create** the epic's topic rather than reuse an existing mapping:

```ts
const created = await adapters.createTopic(epicTopicName(epicTitle));
```

`epicTopicName` just wraps the given title in `` `EPIC — ${epicTitle}` ``,
so a first-ever creation via reconciliation would name the Telegram topic
literally `EPIC — topic-consolidation` instead of the real title (compare
the live-tick path's `decideEpicTopicAction` call, which always passes
`definition.title`). This is not cosmetic — the mis-titled topic is
permanent (nothing else in this parcel or its neighbours renames a topic
after creation) and it happens exactly in `reconcileTopicLifecycle`'s own
reason for existing: BL-330's stated scenario is a ticket whose completion
"happened while the bot was down, crash-looping, or running a stale build,"
i.e. an epic-bound ticket that completes with its epic topic never having
been created through the live tick at all.

No test in this parcel exercises that case. `topicReconciliation.test.js`'s
new epic-bound case (`BL-493: an epic-bound done ticket reuses its
already-mapped epic topic`) pre-seeds `topicMap['dynamic-routing'] = 42`, so
`ensureEpicTopicId` always takes the reuse branch and the wrong-title
create branch is never reached by any test.

## Why this is a bounce, not a rule_proposal

A correctness defect the architect can see is a send-back, not a
`rule_proposal` (BL-333's lesson: a note alone doesn't stop the parcel, and
that exact ticket landed on `main` before the proposal was actioned). This
is architecturally clean code but a concrete, reproducible defect on the
exact new mechanism this ticket introduces, in the exact scenario the
reconciliation module exists to cover.

## Remediation direction (not prescriptive — coder's call on mechanism)

`reconcileTopicLifecycle`/`ReconcileAdapters` needs a way to resolve a
ticket's epic **title**, not just reuse its id as a stand-in. The natural
shape mirrors `ticketRouteContextFor`: export `epicDefinitionsFor` (or an
equivalent title-lookup) from `conciergeTick.ts`, thread an epic-title
resolver into `ReconcileAdapters` (built in `buildReconcileAdapters`,
`telegram-front-desk-bot.ts`, which already has the folders snapshot
available), and use it in place of the current `epicTitle: ticket.epic`.
Add a test that reconciles an epic-bound done ticket whose epic topic is
**not** already in the topic map (i.e. drives the `createTopic` branch of
`ensureEpicTopicId`) and asserts the created topic name carries the epic's
real title, not its id.

## Scope check

Neither `bf90fb9b86` (coder) nor `fca8e7e77d` (cleaner) has this evidence
file's finding as an ancestor — first time raised for BL-493.
