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
| `depends_on` | list[string] | IDs of items that must complete first. |
| `acceptance` | string | Gherkin-style acceptance criteria. |

## Example
```yaml
id: BL-042
title: "Add OAuth login"
description: "Implement OAuth2 login with Google and GitHub providers."
priority: 10
mutation_cost: high  # Heavy: new auth flow, many edge cases
depends_on: [BL-041]  # Depends on user table migration
```
