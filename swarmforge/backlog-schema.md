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
| `epic` | string | (BL-341; required on live non-epic items as of 2026-07-19) Which multi-slice epic this item belongs to, as data — never inferred from `notes:` prose. The epic id namespace is separate from `BL-###` ticket ids. One ticket per epic id also carries `type: epic` (see below) and *is* that epic's own definition, self-referentially declaring the same `epic:` id. Every live ticket under `backlog/active/`, `backlog/paused/`, or `backlog/hold/` that is **not** `type: epic` must set a non-empty `epic:`. |
| `milestone` | string | Required on every `type: epic` tracker (e.g. `M8`). Ordinary slices may also carry `milestone:` for display; epics must not omit it. |

## Optional Fields
| Field | Type | Description |
|-------|------|-------------|
| `workflow_pin` | list[string] | Override the default pack for this item (e.g., `[coder, cleaner]`). |
| `roles` | list[string] | (BL-317) The routing manifest: which pipeline roles this ticket actually needs, as either a flow-style list (`roles: [coder, QA]`) or a block-style list (`roles:` followed by `  - coder` / `  - QA` lines) — both are read identically. Absent means the full standard chain (`specifier, coder, cleaner, architect, hardender, documenter, QA`) — today's behavior, unchanged. A `roles:` field that IS present but cannot be parsed in either form is a validation error rejected before promotion, never silently treated as absent. `coordinator` is never a valid member (bookkeeping only, not a pipeline chain role); `coder` and `QA` are always required even in a declared list. This slice only decides/validates the list — it does not yet bring a role's session up or down based on it (a later slice). |
| `depends_on` | list[string] | IDs of items that must complete first. |
| `acceptance` | string | A path to the item's Gherkin feature file under `specs/features/` (e.g. `specs/features/BL-042-add-oauth-login.feature`) — the feature file is the durable acceptance contract and outlives the backlog item. Older items may still carry the criteria inline (`acceptance: \|` followed by a Gherkin block) until migrated; both forms are read. |
| `human_approval` | string | `pending` or `approved` (BL-251). Set by the specifier to `pending` when it authors or re-specs a feature file that needs human review; a human flips it to `approved`. Unset/absent means not applicable (no approval needed, or a legacy item). This structured field is the SINGLE source for the "needs human approval" lists surfaced in the PWA and the daily briefing — both read this field directly, never the free-text `# HUMAN APPROVAL: ...` comment some items still also carry. Only meaningful on live items (`backlog/active/`, `backlog/paused/`); not read from `backlog/done/`. (BL-357) A ticket's own `BL-###` Telegram topic also gets asked directly on the not-pending → pending transition; replying "approve" in that topic flips this field back to `approved`. |
| `type` | string | (BL-341) E.g. `feature`, `defect`, or `epic`. The one item per epic id carrying `type: epic` is that epic's own definition (its `title` plus `remaining_slices` / `decomposes_into` below), distinct from an ordinary slice merely declaring the same `epic:` id. |
| `remaining_slices` | list[string] | (BL-341) Only meaningful on the epic-defining item (`type: epic`). Free-text descriptions of work known to belong to the epic but not yet ticketed — human/specifier-authored, since nothing in the backlog can derive an unticketed slice's existence on its own. Read as either a flow-style or block-style YAML list, same as `roles`. |
| `decomposes_into` | list[string] | On `type: epic` trackers: child `BL-###` ids. |
| `required_wiring` | list[string] | (BL-531) Call sites this ticket's own mechanism must be wired into, checked by `swarm_handoff.bb`'s pre-QA gate at the moment a `git_handoff` addressed to QA is sent. Each entry is `path::pattern`, with an optional third `::why` segment (split on the first two `::` occurrences, so `::` may appear inside `why` but not in `path`/`pattern`) — either a flow-style list (`required_wiring: [a/b.bb::some-fn]`) or a block-style list (`required_wiring:` followed by `  - "a/b.bb::some-fn"` lines), read identically to `roles`. `path` is read **at the commit cited in the draft**, never the sender's working tree; a missing path or a path present without `pattern` (a fixed-string, non-regex, `str/includes?` check) refuses the send. An entry that cannot be parsed also refuses the send (a `manifest`-class finding) — a typo fails loud, never silently passes. Absent means the ticket declares no required wiring; the gate then only runs its ancestry check. |
| `abandoned_commits` | list[string] | (BL-531) Sha prefixes (10-char abbreviations are enough) the pre-QA gate's ancestry check must NOT flag as stranded, even though they name this ticket and sit off the parcel's lineage — the documented override for a commit deliberately dropped rather than forwarded. Read as either a flow-style or block-style list, same as `roles`/`required_wiring`. |
| `required_stages` | list[string] | (BL-606) Declare which pipeline stages this ticket actually needs, as a single-line flow-style list: `required_stages: [coder, qa]`. Stages NOT listed are skipped at routing time if `required_stages_routing_enabled` is true in `swarmforge.conf` (default false for safety). Stages omitted must have `stage_skip_reasons` entries explaining why. Valid stages are `coder`, `cleaner`, `architect`, `hardender`, `documenter`, `qa` (in that canonical order). Unknown stages, duplicates, or `qa` omitted while `coder` is present are rejected and default to full-chain (all stages). Absent field means the ticket runs the full canonical chain (safe default). |
| `stage_skip_reasons` | mapping | (BL-606) Provide human-readable reasons for each stage omitted from `required_stages`, keyed by stage name: `stage_skip_reasons: { cleaner: "style-only commit", architect: "no architecture changes" }`. One reason per skipped stage. These are committed to git alongside `required_stages` for auditability — `git log` shows both the intent (which stages are needed) and the justification (why others were skipped). Absent or incomplete reasons are a warning; rejecting a ticket with incomplete reasons is a future evolution. |
| `bounce_count` | int | (BL-608) Number of times this ticket has been bounced back during review. Always equals the length of `bounce_history`. Set automatically by `record-qa-bounce` when a bounce is recorded; always recomputed from the list, never manually edited. Absent means zero bounces. |
| `bounce_history` | list[mapping] | (BL-608) Ordered list (oldest first) of bounce events. Each entry is a single-line flow mapping: `{ at: 2026-07-23, by: QA, blamed: coder, class: behavior, commit: 1f7987dd4a, evidence: backlog/evidence/BL-606-qa-bounce-20260723.md }`. Fields: `at` (date), `by` (bouncing role), `blamed` (role held responsible), `class` (failure classification), `commit` (abbrev hash of the bounced commit), `evidence` (path to the bounce evidence file). Append-only; managed by `record-qa-bounce` CLI. Absent means no bounces recorded. |

## Hygiene rules (open backlog)

1. **Every non-epic live ticket has a non-empty `epic:`.**
2. **Every `type: epic` tracker has a non-empty `milestone:`** (and self-declares the same `epic:` id).
3. Audit: `bb swarmforge/scripts/backlog_epic_milestone_audit.bb [project-root]` (exit 1 on violations).

## Example
```yaml
id: BL-042
title: "Add OAuth login"
description: "Implement OAuth2 login with Google and GitHub providers."
epic: auth-onboarding
milestone: M8
priority: 10
mutation_cost: high  # Heavy: new auth flow, many edge cases
depends_on: [BL-041]  # Depends on user table migration
```
