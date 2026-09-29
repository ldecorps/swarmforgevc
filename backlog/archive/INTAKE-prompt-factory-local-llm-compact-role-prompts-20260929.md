# INTAKE — Prompt factory: compact role prompts for local LLMs (all roles)

**Source:** human via Cursor / Claude Code, 2026-09-29 ~10:40 BST, verbatim:
"Intake for a new llm ticket: have prompt factory review all roles prompt to
make them smaller for local llms to digest."

Preceding operator conversation (same session, not to be dropped): the human
asked whether IQ3 competence needs a shorter coder bootstrap like the
coordinator already got; the answer was yes for paths that still use the
**generic** compose (local-model / qwen CLI), while aider seats already got
short notes under BL-1699. Do **not** gut the shared Claude `*.prompt` files
as the only fix — dispatch a local-LLM / compact style from the prompt
factory the way `:aider` already does.

**Epic / track:** `local-llm-swarm` (BL-1125). Sibling of BL-1699 (aider short
role notes + path-free bootstrap) and the local-aider seats plan
(`backlog/archive/INTAKE-local-aider-seats-20260924.md`).

**Priority:** normal unless the specifier judges a queue-jump; the live pack
already mixes Claude with a local IQ3 coder, and composed `coder.md` for
generic/local-model style is still ~15k tokens.

## What is wrong

Local LLMs (ISTA IQ3_S / qwen CLI / Ollama seats that still use
`prompt_engine_lib`'s **generic** bootstrap style) receive the full
constitution + pipeline + role prompt. Measured:

- `.swarmforge/prompts/coder.md` (composed) ≈ 58 KB / ~15k tokens.
- `swarmforge/roles/coder.prompt` alone ≈ 3.5k tokens before constitution
  articles are inlined.
- Evidence: `backlog/evidence/aider-seat-context-budget-20260923.md` —
  Ollama silently truncates when the window is exceeded; seats then look
  "bad at tools" / ignore role duties.
- Aider seats were fixed for this shape by BL-1699 (`roles/aider/*.note` +
  short `aider-bootstrap-text`). **Coordinator** already has a short
  orchestrator bootstrap in that style. Other roles under generic /
  `local-model` compose did not get the same pass.

## What is wanted

Have the **prompt factory** (`prompt_engine_lib.bb` / compose + adapters)
**review every role** and produce a **digestible local-LLM variant** of each
role's standing instructions so a small-context local model can actually
keep the role loop in mind.

Concrete intent (direction for the specifier, not a mandate of one design):

1. **All pipeline roles** that a local pack may staff: at least coder,
   cleaner, architect, hardender, documenter, QA, coordinator, specifier
   (even if some packs omit specifier).
2. **Agent-style dispatch**, not a single shortened Claude prompt:
   Claude / full-forge seats keep today's full prompts byte-stable unless a
   later ticket deliberately changes them; local-model / compact (and any
   future small-window adapter) get short cards, analogous to
   `swarmforge/roles/aider/*.note`.
3. **Prompt factory owns the review and the selection**: which compose
   style / adapter / note file a seat gets is decided at compose/launch
   time from agent (and optionally model / pack), not by hand-editing
   every pack window.
4. **Success criterion:** a local IQ3 (or similar) seat's first-turn
   prompt fits a bounded window the pack/metadata declare (specifier to
   pin the number; today 8k–32k depending on Modelfile), with role duties
   still present — not truncated away.

## Firm constraints

- **Do not** make Claude seats worse or silently swap them onto the compact
  card. Prefer an invariant like BL-1699's: non-local / non-aider providers
  stay byte-identical unless explicitly in scope.
- **Do not** drop constitutional law by "summarizing it away" into a card
  that contradicts Article text; short cards may *point* at duties the
  driver / harness already enforce, the way BL-1699 does for aider.
- Preserve human sentences from this intake verbatim in any minted ticket
  (Article 5.3).

## Evidence / pointers for the specifier

- `backlog/evidence/aider-seat-context-budget-20260923.md`
- `backlog/done/M8/BL-1699-aider-seats-launch-with-a-short-role-note-no-repo-paths-and-the-seat-test-loop.yaml`
- `swarmforge/scripts/prompt_engine_lib.bb` (`compose`, `:aider` vs
  `:generic`, `local-model` capabilities)
- `swarmforge/roles/aider/coder.note`, `generic.note`
- `swarmforge/packs/ista-iq3s-coder.Modelfile` (num_ctx 32768 because coder
  bootstrap alone blew 8k)

## Suggested slice shape (optional)

One ticket if the factory can introduce a single `local-compact` (or
extend `local-model`) bootstrap style + one short note per role; or a
small epic: (1) factory dispatch + coder/coordinator cards, (2) remaining
roles, (3) pack/metadata window assertions. Specifier chooses envelope.

## Out of scope (unless specifier widens)

- Giving aider an action channel / replacing the parcel driver (BL-1696–1698).
- Model capability / edit-format probing (BL-1700).
- Elevator speech / marketing copy.
- Changing constitution article files themselves solely to save tokens.

## Disposition (specifier, 2026-09-29)

Minted on the human's "Mint this", split 1:N (Consolidation Authority, BL-680).
The human sentence is carried verbatim into every resulting ticket:

- BL-1798: the factory's `local-compact` style for the local-model agent, the
  shared loop card and the coder card (intent items 2-3; the 8192-character
  budget pins item 4 for the card itself). A role with no card composes as
  today.
- BL-1799: cards for cleaner, architect, hardender and documenter (intent
  item 1, first half).
- BL-1800: cards for QA, coordinator and specifier, plus the census of the
  eight roles local-model-mono-router.conf staffs (intent item 1, second
  half).
- The BL-1125 remaining slice covers the window check against the num_ctx a
  pack or model declares (intent item 4 as stated). It needs a ruling on the
  window source and on refuse-vs-warn before it can be minted.

Firm constraints: every ticket keeps non-local-model agents byte-identical,
edits no `*.prompt` or constitution article, and has cards point at Article
text, never restate it. Out of scope as the intake lists.
