# INTAKE — DEFECT: onboarding a genuinely greenfield target hits five real gaps, only found by actually reaching a live launch (broken survey-template prose, an incompatible bootstrapped engine, missing git-hooks wiring, the front desk's hardcoded dependency on a compiled VS Code extension, and Claude Code's own first-run trust dialog blocking headless panes)

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

## Gap 3 — the bootstrapped upstream engine doesn't understand this project's own config vocabulary at all (worse than Gap 1 suggested)

Copying `mono-router.conf` (this repo's own, confirmed generic) onto the
self-installed upstream `swarmforge/scripts/` was not enough on its own.
Launch refused with `Invalid config line 6: config
active_backlog_max_depth 2` — a byte-for-byte-identical line to one this
repo's own `swarmforge.conf` uses today (`config active_backlog_max_depth
6`, `swarmforge/swarmforge.conf:16`).

Cause, confirmed live: **this repo no longer has a `swarmforge.bb` at
all** (`find . -iname swarmforge.bb` finds nothing outside
`.worktrees/`) — its config-parsing logic was refactored years ago into
`swarmforge.sh` plus a family of focused `.bb` scripts
(`backlog_depth_cli.bb`, `promotion_gates_lib.bb`, etc.). The
self-installed upstream `swarmforge.bb` (1,071 lines, fetched fresh from
`unclebob/swarm-forge`) is a genuinely older, differently-shaped parser
built for the Lieutenant/`projects/` paradigm (Gap 1) and does not
recognize this project's own pipeline config keys at all — not a missing
value, a different, incompatible engine.

**What actually unblocked it:** deleting the bootstrapped
`swarmforge/scripts/` entirely and replacing it with a full copy of this
repo's own `swarmforge/scripts/` (used unmodified — the same tree this
session already launched `full-forge` and `ollama-ista-iq3s-mono-router`
with tonight). That surfaced a second, related gap immediately: this
repo's own commit guards are wired via `core.hooksPath =
swarmforge/git-hooks` (a tracked directory), never `.git/hooks/`
directly — but the FIRST (vestigial) launch attempt had already installed
a stray `.git/hooks/commit-msg` pointing at a script
(`commit_msg_hook.bb`) that doesn't exist anywhere in this repo's own
scripts, from an older hook-installation convention the bootstrapped
`swarmforge.sh` apparently still uses. `swarmforge/git-hooks/` (4 files)
also needs copying and `core.hooksPath` needs setting explicitly; nothing
in the launch path does this for a fresh target today.

## Gap 4 — the Telegram front desk hardcodes a dependency on a compiled VS Code extension

`launch_front_desk.sh` (copied in unmodified with the rest of
`swarmforge/scripts/`) resolves its bridge entrypoint as
`"$ROOT/extension/out/tools/start-bridge-headless.js"` — `$ROOT` being
the *target's own* project root. This is true for swarmforgevc because
here the thing-being-built and the thing-running-the-swarm are the same
repo; it is never true for an unrelated target. Launch failed cleanly
(`bridge entrypoint not found ... run npm run compile in extension/`),
and so did the Cursor Remote bridge for the identical reason.
`gpu-bargain-hunter` is running with no Telegram monitoring and no
`/rc` (remote-control-from-phone) as a direct result — a real gap given
the whole point of provisioning this target's own dedicated bot
(BL-380/381) was phone-based monitoring from launch.

The onboarding CLIs this session used successfully throughout
(`propose-onboarding-contract.js`, `provision-onboarding-telegram-channel.js`,
etc.) are all run FROM swarmforgevc's own compiled `extension/out/tools/`,
taking the target path as an argument — proving the pattern "swarmforgevc's
compiled tools operate on a target path" already works. The front desk
bridge itself has never been exercised that way; it assumes co-location.

## Gap 5 — Claude Code's own first-run trust dialog blocks a headless pane, silently, on a genuinely new directory

Not a `swarmforge` gap, but hit in the same session and worth recording
here since it's part of the same "never exercised against a truly fresh
directory tree" story: every Claude-agent pane in a brand-new
`--dangerously-skip-permissions` launch first hits Claude Code's own
one-time-per-directory "Is this a project you created or one you trust?"
dialog, which that flag does **not** cover. Observed live: the
`coordinator` pane sat silently stuck on it (status showed `UP`, looked
healthy, was actually blocked on stdin); the `coder` pane's session
**vanished entirely** — consistent with an unattended/empty input
landing on the dialog's highlighted default, `❯ No, exit`, which exits
the process and (with no `remain-on-exit`) closes the pane, so `coder`
read as cleanly `DOWN` with no error to explain why.

Trust state lives in `~/.claude.json`'s `projects` map
(`hasTrustDialogAccepted: true` per absolute path) — every worktree
swarmforgevc itself launches into is presumably already trusted from
earlier sessions, which is why this has apparently never been hit before
tonight. `swarm ensure`'s own repair pass, run after answering the
coordinator's prompt by hand, respawned `coder` and — unexplained, worth
someone confirming rather than assuming — it did *not* re-hit the
dialog. If that was inherited trust from the already-answered root rather
than a fluke, launching a target's `coordinator`/`master` pane first,
answering its dialog, then bringing up the rest may already be a
sufficient real-world fix; if it was a fluke, every fresh worktree needs
its own answer.

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
3. Gap 3: whatever Gap 1's fix installs, make sure the *engine*
   (`swarmforge/scripts/`) it installs actually understands the config
   vocabulary of whatever pack it ships alongside — a starter kit whose
   pack and whose parser disagree fails exactly this way again. Also wire
   `swarmforge/git-hooks/` + `core.hooksPath` for a fresh target (nothing
   does today), and stop installing a stray `.git/hooks/commit-msg` that
   points at a script the installed engine doesn't have.
4. Gap 4: make the front desk (and Cursor Remote bridge) reachable for an
   unrelated target — most likely by pointing them at swarmforgevc's own
   compiled `extension/out/` via an explicit location rather than assuming
   `$ROOT/extension/out/` exists, mirroring the pattern the onboarding
   CLIs already use successfully (run from swarmforgevc, target path as an
   argument).
5. Gap 5: confirm whether trusting a target's root/`master` pane before
   bringing up its worktree panes is a real, reliable fix, or a fluke —
   then either document that ordering as part of the launch flow, or make
   the launch pre-trust every pane path it's about to start (worktrees
   included) the way the standing worktrees this repo already runs
   presumably were, at some point, made to be.

Draft acceptance (the specifier refines at mint; likely five tickets, or
fewer if some share a fix):

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

Scenario: The installed engine understands the installed pack's config
  Given a fresh target launched with a starter pack
  When the pack's own config file is read at launch
  Then every config line it contains is recognized, not refused

Scenario: A fresh target's commits are guarded like every other target's
  Given a fresh target launched for the first time
  When a commit is made in it
  Then the same commit guards swarmforgevc itself runs are enforced

Scenario: The front desk reaches an unrelated target
  Given a fresh, unrelated target with its own Telegram bot provisioned
  When the front desk is launched for it
  Then the bridge and bot start, with no extension/ of its own required

Scenario: A fresh target's panes don't silently die on the trust dialog
  Given a fresh target directory Claude Code has never seen
  When its panes are launched non-interactively
  Then no pane is blocked or exits on an unanswered trust dialog
```

## Disposition (specifier, 2026-09-25)

Split 1:N (BL-680, Article 5.3) under a new epic tracker, **BL-1755**
(`onboarding-target-repo`). The human's sentence is carried verbatim in
every resulting ticket's `source:`.

- Gap 2 (empty survey) -> **BL-1756**.
- Gap 4 (front desk / Cursor Remote need `$ROOT/extension/out`) ->
  **BL-1757**, severity high (a live swarm's phone monitoring is down),
  auto-approved at mint. The other `$ROOT/extension/out` consumers,
  censused at mint, are BL-1755's remaining slice.
- Gaps 1 and 3 (starter kit; the engine must understand the pack it
  ships; git-hooks and the stray commit-msg hook) -> **BL-1758**, one
  ticket because they are one fix. A real choice went to the human
  (A kit from the local checkout, recommended / B our own pinned tarball
  / C docs only). The current wrapper's floating-upstream fetch also
  breaks Architecture Rule 2.
- Gap 5 (trust dialog) -> **BL-1759**. Its investigation was done at
  mint: trust is inherited from a trusted ancestor (this host trusts both
  roots and no `.worktrees` path, yet every pane runs). A real choice went
  to the human (A read-only check that stops and says how, recommended /
  B write the trust flag / C answer the dialog by keystroke).
