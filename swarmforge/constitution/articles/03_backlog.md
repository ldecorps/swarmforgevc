# Article 3: Backlog Management

## 3.1 Backlog Structure
- `backlog/paused/` – Items awaiting promotion.
- `backlog/active/` – Items currently in the pipeline.
- `backlog/done/` – Completed items.

## 3.2 Promotion Rules
1. **Max Active Depth** – The coordinator must enforce `active_backlog_max_depth` (from `swarmforge.conf`).
2. **Eligibility** – Items are promoted in priority order (highest first).
3. **Orthogonality** – Avoid promoting items that conflict with active work.

## 3.3 Coordinator Duties
1. **Intake Control** – New items land in `backlog/paused/`.
2. **Promotion** – Move items to `backlog/active/` when slots are available.
3. **Recheck on Merge/Close** – After a merge or close, recheck `active_backlog_max_depth` and promote if possible.

## 3.4 Mutation-Heavy Scheduling
- Prefer promoting **light** tickets (docs, config) during office hours.
- Defer **mutation-heavy** tickets (large code changes) to overnight.
