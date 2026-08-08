# constitution.prompt — detailed reference (BL-858 split)

On-demand elaboration for `swarmforge/constitution.prompt`. Not inlined at
boot.

## Structure — full text before this parcel tightened the wording

`constitution.prompt`'s own "Structure" section, verbatim, before BL-858
(every fact below — the 5 articles, the 4 unnumbered prompt files, the
reference/ directory's purpose — is unchanged in the compressed version,
just stated with less connective prose):

> The constitution is organized into **articles**, each stored in `swarmforge/constitution/articles/`. Articles are numbered sequentially (e.g., `01_roles.md`, `02_handoffs.md`) and cover:
>
> 1. **Roles and Responsibilities** – Duties of each agent in the pipeline.
> 2. **Handoff Protocol** – Rules for `git_handoff` and message passing.
> 3. **Backlog Management** – How parcels are prioritized and promoted.
> 4. **Quality Gates** – Criteria for merging into `main`.
> 5. **Amendments** – Process for updating the constitution itself.
>
> The directory also carries project-wide prompt articles (not numbered) that apply
> alongside the numbered articles: `engineering.prompt`, `workflow.prompt`,
> `local-engineering.prompt`, and `project.prompt`.
>
> Long-form incident-backed elaborations live under
> `swarmforge/constitution/articles/reference/` (for example
> `engineering-detailed.prompt`, `workflow-detailed.prompt`). Those files are
> **not** inlined into the boot system prompt — read them on demand when a task
> touches that domain.

## Key Rules and Amendments — full text before this parcel pointed at the articles

`constitution.prompt`'s own text, verbatim, before BL-858 compressed the
"Key Rules" and "Amendments" sections to an index (the same content is
stated in full in `PIPELINE.md`, `01_roles.md`, `02_handoffs.md`, and
`05_amendments.md` — all same boot prefix — this snapshot exists so the
exact prior top-level-summary wording stays retrievable):

> ## Key Rules
> 1. **Pipeline Flow**: Parcels move through the chain `specifier → coder → cleaner → architect → hardener → documenter → QA (integrate) → coordinator (bookkeep)`.
> 2. **Worktrees**: Each role works in its own branch (e.g., `.worktrees/coder`). **QA** lands QA-approved work on `main`; the coordinator does backlog bookkeeping only and the specifier never performs integration merges (BL-247).
> 3. **Handoffs**: Use `swarm_handoff.sh` to send parcels; never write directly to `inbox/new/`.
> 4. **No-Op Rule**: A role must **not** forward a `git_handoff` if the received commit produces no functional change.
>
> ## Amendments
> To propose a change to the constitution:
> 1. Create a new article in `swarmforge/constitution/articles/` (e.g., `99_proposed_change.md`).
> 2. Route it to the **specifier** via `git_handoff` with priority `00`.
> 3. The **specifier** incorporates approved constitution changes into spec/prompt files; **QA** lands them on `main` after approval and the coordinator does backlog bookkeeping (BL-247).
