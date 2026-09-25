# INTAKE — DEFECT: onboarding a genuinely greenfield target hits two real gaps (broken survey-template prose, and no working path to an actual launch)

**Source:** the operator (Claude Code), while live-onboarding a real new
target (`/home/carillon/gpu-bargain-hunter`) at the human's request,
2026-09-25. The human, on being told what the workaround actually involved:

> Happy for you to hit fix to get the ball rolmibg but let the swarm know

Filed per that instruction — a hand workaround unblocked the one target,
this ticket is so the underlying gaps get a real fix, not a per-target
repeat of the same workaround.

**Kind:** defect. Neither gap makes anything worse for an *existing* target
(swarmforgevc itself is unaffected — it already has its own packs/roles/
prompts), so this is scoped to the onboarding-a-new-target path, not a
regression on `main`. Recommend the specifier grade severity; it blocks
`docs/tutorials/Onboarding-New-Project.md`'s own documented flow for
anyone onboarding a genuinely fresh target, which is presumably not rare.

## Gap 1 — the self-install bootstrap + upstream template can't reach a working launch

**What the docs promise.** `docs/how-to/BL-1582-onboarder-run-an-onboarding-end-to-end.md`
section 6: at `ready-to-launch`, the Onboarder "posts the exact launch
command (`./swarm <path> --pack mono-router`)... The human runs that
command themselves, on the target host."

**What actually happens on a target with no pre-existing `swarmforge/`.**
`./swarm`'s own self-install block (top-level `swarm`, this repo) only
does this, when `swarmforge/scripts` is missing:

```sh
curl -L "$ARCHIVE_URL" | tar -xz --strip-components=1 -C "$TMP_DIR"
if [[ ! -d "$SCRIPT_DIR/swarmforge/scripts" ]]; then
  cp -R "$TMP_DIR/swarmforge/scripts" "$SCRIPT_DIR/swarmforge/scripts"
fi
if [[ -d "$TMP_DIR/swarmforge/constitution/articles" ]]; then
  mkdir -p "$SCRIPT_DIR/swarmforge/scripts/shared-articles"
  cp -R "$TMP_DIR/swarmforge/constitution/articles/." "$SCRIPT_DIR/swarmforge/scripts/shared-articles/"
fi
```

It copies exactly two things: `swarmforge/scripts` and
`swarmforge/constitution/articles` (into `scripts/shared-articles`, a
different path than where the constitution actually lives). It copies
**nothing else** — no `swarmforge.conf`, no `swarmforge/roles/`, no
`swarmforge/packs/`, no `swarmforge/constitution.prompt`, no
`swarmforge/handoff-protocol.md`. Running `./swarm <path>` against a bare
target fails immediately: `Error: Config not found at
<path>/./swarmforge/swarmforge.conf`.

**Even a complete copy of the upstream template wouldn't reach
`--pack mono-router`.** Measured live tonight by fetching
`https://github.com/unclebob/swarm-forge/archive/refs/heads/main.tar.gz`
(the same `ARCHIVE_URL` the bootstrap uses) and inspecting it in full:

- `swarmforge/packs/` **does not exist at all** in the upstream template.
  No `mono-router.conf`, no pack of any name.
- `swarmforge/roles/` holds exactly one file, `lieutenant.prompt` — and
  it describes a different topology entirely: "You oversee the forge:
  `projects/`, the dashboard, and the operator's chat. You are not a pack
  agent... Do not implement project work. That belongs to pack agents."
  This is a multi-project forge-manager role, not the specifier→coder→
  cleaner→architect→hardener→documenter→QA→coordinator single-project
  pipeline every onboarding doc, the contract/gate machinery, and
  `backlog/`/`specs/features/` conventions all assume.
- `swarmforge/swarmforge.conf` upstream is two comment lines and one
  commented-out example (`# Lieutenant claude --yolo`) — a stub for the
  Lieutenant/projects/ paradigm, not a starter for the pipeline paradigm.

So `swarmforgevc`'s own `packs/`, 8-role prompt set (7,216 lines total,
`swarmforge/roles/*.prompt`), and populated `swarmforge.conf` are this
project's **own accumulated customization** on top of a much thinner,
differently-shaped upstream base — not something a fresh bootstrap
provides, and not something the upstream repo's own paradigm even
produces. `./swarm <path> --pack mono-router` cannot work as the docs
describe against a genuinely fresh target today.

**What I actually did to unblock the one target (not a fix, a
workaround):** hand-copied `swarmforgevc`'s own `constitution/` (pruning
`articles/reference/` — dated, swarmforgevc-specific amendment history —
and `project.prompt`/`local-engineering.prompt`/`engineering.prompt`,
which describe *this* project, "a Visual Studio Code extension called
SwarmForge VC" — wrong for any other target), `handoff-protocol.md`, and
`packs/mono-router.conf` + `packs/mono-router.prompt` (both confirmed
generic — zero swarmforgevc-specific references), then hand-wrote 8 new,
short, project-agnostic role prompts from scratch, since swarmforgevc's
own are too specific to copy (TypeScript/vitest/extension-path references
throughout, even in the shortest one, `coder.prompt` at 209 lines).

## Gap 2 — the survey-to-template code breaks on an empty/greenfield survey

Measured live against the same target. `proposeContractFromSurvey`
(`extension/src/onboarding/contractSurvey.ts`) and
`proposePromptsFromSurvey` (`extension/src/onboarding/promptProposal.ts`)
both assume a survey of **existing** code; a target with none produces
broken output rather than a graceful empty case:

- `CONTRACT.md`'s scope reads "Work within the existing the surveyed
  codebase (layout: ...)" and out-of-scope reads "Rewriting or replacing
  the existing the surveyed stack." — grammatically broken (missing
  the actual layout noun both times), because `layoutSummary` was a full
  sentence ("Greenfield project: only README.md... exist. No source tree,
  no chosen language/runtime yet.") slotted into a template expecting a
  short phrase.
- The generated `engineering.prompt`'s Tech Stack section is worse than
  clunky — it's genuinely empty: `languages: []` (nothing chosen yet)
  collapses to a `# Tech Stack` heading followed by the literal line
  "the surveyed" and nothing else.

`USE-CASES.md` (`deriveUseCaseInventory` /
`generateUseCaseInventoryMarkdown`) handles the identical empty case
correctly today — "No discernible use cases were found in this
codebase." — proving the graceful-empty-case pattern already exists in
this codebase; the contract and prompt derivations just don't use it.

## Ask

1. Gap 1: make `./swarm <path> --pack mono-router` actually reach a
   working launch against a target bootstrapped from nothing but the
   self-install block — either by having the bootstrap install a real,
   generic pipeline starter kit (this repo's own `mono-router.conf` +
   `mono-router.prompt`, already confirmed generic, plus a genuinely
   concise generic role-prompt set — not swarmforgevc's own 7,216-line
   evolved versions), or by fixing/updating the docs to describe what a
   fresh target actually needs and how to get it. The `unclebob/swarm-forge`
   upstream repo is out of this codebase's control; don't assume changing
   it is in scope.
2. Gap 2: give `proposeContractFromSurvey` and `proposePromptsFromSurvey`
   the same graceful-empty-case handling `deriveUseCaseInventory` already
   has, for an empty `languages` array and a `layoutSummary` that's a full
   sentence rather than a short noun phrase.

Draft acceptance (the specifier refines at mint; likely two tickets):

```gherkin
Scenario: A target with nothing but a README reaches a real launch command
  Given a target directory containing only a README and no swarmforge/ tree
  When ./swarm <path> is run against it for the first time
  Then a pack naming a real, working role-prompt set is available to launch
  And --pack mono-router (or the docs' updated equivalent) actually starts

Scenario: An empty survey produces a grammatical contract
  Given survey facts with languages: [] and a full-sentence layoutSummary
  When proposeContractFromSurvey runs
  Then CONTRACT.md's scope and out-of-scope read as complete sentences

Scenario: An empty survey produces a real engineering.prompt
  Given survey facts with languages: []
  When proposePromptsFromSurvey runs
  Then the generated engineering.prompt's Tech Stack section says
    plainly that no stack is chosen yet, never a truncated fragment
```
