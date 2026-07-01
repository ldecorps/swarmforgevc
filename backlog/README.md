# Backlog

One YAML file per work item. On startup, read the `active/` items to know what to work on.

## Directory layout

- `active/` — items currently queued for implementation (M2+)
- `paused/` — staged items waiting for coordinator promotion
- `done/` — items that are complete and merged
- Root — the human's raw intake queue. The specifier drains root items first
  (turning each into a spec in `paused/`) before looking at queued work.

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

Intake vs. promotion are two separate steps with opposite root/paused priority:
- Specifier intake: drain the human's raw items at the backlog **root first**,
  writing a spec for each into `paused/`, before touching queued work.
- Coordinator promotion: promote from `paused/` first, then the backlog root only
  when `paused/` is empty.

Active queue depth is bounded by `swarmforge.conf` `config
active_backlog_max_depth`.
