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
| `roles` | list[string] | (BL-317) The routing manifest: which pipeline roles this ticket actually needs, as a flow-style list (e.g. `roles: [coder, QA]`). Absent means the full standard chain (`specifier, coder, cleaner, architect, hardender, documenter, QA`) — today's behavior, unchanged. `coordinator` is never a valid member (bookkeeping only, not a pipeline chain role); `coder` and `QA` are always required even in a declared list. This slice only decides/validates the list — it does not yet bring a role's session up or down based on it (a later slice). |
| `depends_on` | list[string] | IDs of items that must complete first. |
| `acceptance` | string | A path to the item's Gherkin feature file under `specs/features/` (e.g. `specs/features/BL-042-add-oauth-login.feature`) — the feature file is the durable acceptance contract and outlives the backlog item. Older items may still carry the criteria inline (`acceptance: \|` followed by a Gherkin block) until migrated; both forms are read. |
| `human_approval` | string | `pending` or `approved` (BL-251). Set by the specifier to `pending` when it authors or re-specs a feature file that needs human review; a human flips it to `approved`. Unset/absent means not applicable (no approval needed, or a legacy item). This structured field is the SINGLE source for the "needs human approval" lists surfaced in the PWA and the daily briefing — both read this field directly, never the free-text `# HUMAN APPROVAL: ...` comment some items still also carry. Only meaningful on live items (`backlog/active/`, `backlog/paused/`); not read from `backlog/done/`. |

## Example
```yaml
id: BL-042
title: "Add OAuth login"
description: "Implement OAuth2 login with Google and GitHub providers."
priority: 10
mutation_cost: high  # Heavy: new auth flow, many edge cases
depends_on: [BL-041]  # Depends on user table migration
```
