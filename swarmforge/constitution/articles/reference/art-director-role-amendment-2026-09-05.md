# AMENDMENT (INCORPORATED): the Art Director role

> **Status: INCORPORATED, 2026-09-05** (Article 5.1 step 2, by the specifier).
> The binding form lives in **Article 1.10** (`articles/01_roles.md`), the
> **`PIPELINE.md`** roles table, and **`swarmforge/roles/art-director.prompt`**.
> This file is the adoption record and rationale.
>
> **Origin:** human directive, in-session, 2026-09-05 ~06:00Z, verbatim:
>
> > introduce new role: Art Director.
> >
> > whose job is tonlook at the look and feel on arte facts produced by the swarm.
> >
> > first job: reflow text in daily breigin email. also make it better looking overall.

## 1. What the role is

A look-and-feel reviewer for every artifact the swarm produces for a human,
modelled on the Model Steward's altitude (an infrastructure role beside the
coordinator, outside the forward chain) rather than on a pipeline stage. It
keeps an artifact inventory and a design system under `docs/design/`, writes
design briefs the specifier mints from, and answers QA's sign-off note on
artifact parcels. It never mints tickets and, unless the human rules
otherwise on BL-1418, never edits production code.

## 2. What is decided and what is not

Decided here: the mandate (Article 1.10), the worktree, the brief/inventory
/system deliverables, the QA sign-off note, and that the specifier remains
the sole minter (Article 1.2 unchanged).

Left to the human on **BL-1418** (`ruling_options`): the seat shape —
standing pane, on-demand seat, or presentation stage. Article 4.3's routing
row for a look-and-feel defect lands with that ruling: under a reviewer
shape the fix routes to the owning implementer with the brief attached;
under a stage shape it routes to the art director.

## 3. Boot prefix

Article 1.10 plus the PIPELINE.md row cost 923 characters:
`boot_prefix_budget_gate` measured 42559 before and 43482 after, under the
44000 budget (BL-859). Headroom is now 518 characters; the next boot-inlined
addition must move prose to `reference/` first.

## 4. Tickets

- **BL-1417** — epic `art-direction` (tracker).
- **BL-1418** — onboard the role into the pack (roles lists, topic icon,
  worktree, mailbox, launch), seat shape by ruling.
- **BL-1419** — the first job: the daily briefing email reflows its text
  and gets a proper layout.
