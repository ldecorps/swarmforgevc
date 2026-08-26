# BL-007 Spec: Backlog Panel

## Goal

Add a read-only "Backlog" section to the SwarmForge panel webview that lists work
items from `backlog/active/*.yaml` and `backlog/done/*.yaml` in the target repo.

## Scope

- Read-only. No editing, drag-drop, or status changes from the UI.
- Visible only when a target path is configured and the `backlog/` directory exists.
- Refreshes on the existing poll interval (≤5 s).

## Required YAML fields to display

Each `.yaml` file must have at minimum:
- `id` — string (e.g. `BL-007`)
- `title` — string
- `status` — one of `todo`, `active`, `done`
- `assigned_to` — optional string (omit badge if absent)

Other fields (milestone, priority, description, acceptance) are ignored by the panel.

## Layout (within the webview)

Place a **Backlog** `<section>` below the agent tiles and pipeline status.

```
─────────────── Backlog ────────────────
[active]  BL-007  Backlog panel          coder
[todo]    BL-009  Some future item
▶ Done (2)                               ← collapsed by default
```

- Active items first, then todo, then done (collapsed `<details>` element).
- Each row: status badge, id, title, assigned_to (right-aligned, omitted if absent).
- Status badges: active → green, todo → grey, done → muted.

## Extension-host changes

### `swarmPanel.ts`

1. After a target path is set, start polling `backlog/active/` and `backlog/done/` on the
   same interval as pipeline status (or piggyback the existing `stagePoller`).
2. Read every `*.yaml` file in both directories using Node.js `fs` (not a shell call).
3. Parse YAML with a minimal hand-rolled parser **or** use `js-yaml` if already a dep;
   do NOT add new npm deps without checking `package.json` first.
4. Post a `backlogUpdate` message to the webview with the parsed items array.

Message shape:
```ts
{ command: 'backlogUpdate', items: BacklogItem[] }

interface BacklogItem {
  id: string;
  title: string;
  status: 'todo' | 'active' | 'done';
  assignedTo?: string;
}
```

### `webviewHtml.ts`

Handle `backlogUpdate` in the message listener. Render the section described above.
Hide the section if `items` is empty or message never arrives.

## Acceptance criteria (from BL-007 YAML)

- [ ] Panel shows a "Backlog" section below the agent tiles.
- [ ] Active items appear at the top, todo below, done collapsed at the bottom.
- [ ] Each item shows: id, title, status badge, assigned_to (if set).
- [ ] List refreshes automatically (≤5 s lag when a YAML file changes on disk).
- [ ] Section hidden when no target path or no `backlog/` directory.

## Out of scope

- No filtering, search, or sorting controls.
- No item detail view.
- No editing or status transitions.
- No milestone grouping.
