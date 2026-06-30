# Backlog

One YAML file per work item. On startup, read the `active/` items to know what to work on.

## Directory layout

- `active/` — items currently queued for implementation (M2+)
- `done/` — items that are complete and merged
- Root — (empty; all M1 items are in done/)

## Status values

The status shown in the backlog panel is determined by the folder location, not the YAML `status` field:

- Items in `backlog/done/` always display as `done`, regardless of their `status` field.
- Items in `backlog/active/` use their YAML `status` field:
  - `todo` — not started
  - `active` — currently being worked on
  - `done` — (not used in active folder; move items to done/ instead)

## Fields

- `id` — stable identifier (never changes)
- `title` — short description
- `milestone` — M1, M2, M3, …
- `status` — todo / active / done
- `priority` — lower number = higher priority
- `description` — what behavior is wanted and why
- `acceptance` — observable signals that the item is done
- `assigned_to` — role currently responsible

## Convention

The coordinator owns status transitions. The human owns all other fields.
Items are processed in priority order within each milestone.
