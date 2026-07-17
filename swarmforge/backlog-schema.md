# Backlog Item Schema

Every backlog item is a YAML file in `backlog/active/` or `backlog/paused/`.
The coordinator reads these to route work.

## Required Fields
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., `BL-042`) |
| `title` | string | Short description of the work |
| `description` | string | Detailed requirements |
| `priority` | int | Lower = higher priority (e.g., `0` for critical) |
| `mutation_cost` | string | Estimated mutation testing cost: `low`, `medium`, or `high`. Used by the coordinator to sequence promotion. |

## Optional Fields
| Field | Type | Description |
|-------|------|-------------|
| `workflow_pin` | list[string] | Override the default pack for this item (e.g., `[coder, cleaner]`). |
| `roles` | list[string] | (BL-317) The routing manifest: which pipeline roles this ticket actually needs, as either a flow-style list (`roles: [coder, QA]`) or a block-style list (`roles:` followed by `  - coder` / `  - QA` lines) — both are read identically. Absent means the full standard chain (`specifier, coder, cleaner, architect, hardender, documenter, QA`) — today's behavior, unchanged. A `roles:` field that IS present but cannot be parsed in either form is a validation error rejected before promotion, never silently treated as absent. `coordinator` is never a valid member (bookkeeping only, not a pipeline chain role); `coder` and `QA` are always required even in a declared list. This slice only decides/validates the list — it does not yet bring a role's session up or down based on it (a later slice). |
| `depends_on` | list[string] | IDs of items that must complete first. |
| `acceptance` | string | A path to the item's Gherkin feature file under `specs/features/` (e.g. `specs/features/BL-042-add-oauth-login.feature`) — the feature file is the durable acceptance contract and outlives the backlog item. Older items may still carry the criteria inline (`acceptance: \|` followed by a Gherkin block) until migrated; both forms are read. |
| `human_approval` | string | `pending`, `pending-review`, `amending`, `approved`, or `rejected` (BL-251/BL-357/BL-408/BL-409/BL-509). Set by the specifier to `pending` when it authors or re-specs a feature file that needs human review; a human flips it to `approved` (or `rejected`). Unset/absent means not applicable (no approval needed, or a legacy item). This structured field is the SINGLE source for the "needs human approval" lists surfaced in the PWA and the daily briefing — both read this field directly, never the free-text `# HUMAN APPROVAL: ...` comment some items still also carry. Only meaningful on live items (`backlog/active/`, `backlog/paused/`); not read from `backlog/done/`. (BL-357) A ticket's own `BL-###` Telegram topic also gets asked directly on the not-pending → pending transition; replying "approve" in that topic flips this field back to `approved`. (BL-509) Tapping the Approvals card's Amend button and replying with a steer flips this field to `amending` — a distinct, non-terminal state: the ticket leaves the Approvals topic while the specifier revises it per the steer, then flips it back to `pending` on re-present, which re-asks. **LITERAL VALUES ONLY — never a prose/folded block** (human directive 2026-07-17): the detector matches the literal line `human_approval: pending`; a `human_approval: >` prose block parses as not-pending and the ticket silently never surfaces on the Approvals topic (14 live tickets were dark this way before it was caught). Decision context belongs in `approval_context`. |
| `approval_context` | string | (2026-07-17, introduced on BL-479) Free-prose companion to `human_approval`: WHAT specifically needs the human's sign-off, what is firm vs open. This is where the old prose-style `human_approval: >` content belongs. Read by humans (and BL-480's enriched approval ask); never parsed for approval state. |
| `epic` | string | (BL-341) Which multi-slice epic this item belongs to, as data — never inferred from `notes:` prose. Absent means no epic; every existing item stays valid, unchanged. The epic id namespace is separate from `BL-###` ticket ids. One ticket per epic id also carries `type: epic` (see below) and *is* that epic's own definition, self-referentially declaring the same `epic:` id. |
| `type` | string | (BL-341) E.g. `feature`, `defect`, or `epic`. The one item per epic id carrying `type: epic` is that epic's own definition (its `title` plus `remaining_slices` below), distinct from an ordinary slice merely declaring the same `epic:` id. |
| `remaining_slices` | list[string] | (BL-341) Only meaningful on the epic-defining item (`type: epic`). Free-text descriptions of work known to belong to the epic but not yet ticketed — human/specifier-authored, since nothing in the backlog can derive an unticketed slice's existence on its own. Read as either a flow-style or block-style YAML list, same as `roles`. |

## Example
```yaml
id: BL-042
title: "Add OAuth login"
description: "Implement OAuth2 login with Google and GitHub providers."
priority: 10
mutation_cost: high  # Heavy: new auth flow, many edge cases
depends_on: [BL-041]  # Depends on user table migration
```
