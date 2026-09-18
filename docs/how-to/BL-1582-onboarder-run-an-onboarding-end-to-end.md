# Running an Onboarding End to End with the Onboarder

Task-oriented guide for an operator: what starts the Onboarder, how to know
it is up, how to drive one target from a repo URL to `done`, where its state
lives, how to recover a stalled onboarding, and how to stop it. For the
per-reply conversation semantics (what each control word does), see
[Onboarding a New Project, section 0](../tutorials/Onboarding-New-Project.md#0-the-onboarder-a-guided-conversational-front-end-bl-590bl-624bl-625-all-3-slices-shipped).
For what shipped and where the code is, see
[BL-643 non-pipeline agents as a class](../explanation/BL-643-non-pipeline-agents-as-a-class.md).
This page describes shipped behaviour only.

## 1. Preconditions

The Onboarder is a standing ancillary on the swarm's own host (never the
target host), started automatically by `swarmforge/scripts/start_ancillary_services.sh`
whenever both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set and
`SWARMFORGE_SKIP_ONBOARDER` is unset (`SWARMFORGE_SKIP_ONBOARDER=1` skips it
deliberately). There is **one** Onboarding topic, ensured once in the
primary swarm's own Telegram group and reused across every target — never
one topic per target. A target being onboarded needs its own, separate
Telegram bot token; the **bot-token** prerequisite step below collects it,
and it is never the primary swarm's own token (two long-pollers sharing one
token collide).

## 2. Start and verify

- `./swarm` starts the whole swarm, including the ancillaries via
  `swarmforge/scripts/start_ancillary_services.sh`, which itself calls
  `swarmforge/scripts/launch_onboarder.sh` (usage:
  `swarmforge/scripts/launch_onboarder.sh <swarm-repo-root>`).
- To start the Onboarder alone by hand, run
  `swarmforge/scripts/launch_onboarder.sh` with the swarm repo root as its
  one argument. It is idempotent — already running, it reports the existing
  pid and does not double-launch. It supervises the reconcile poll-loop via
  `swarmforge/scripts/onboarder_supervisor.bb`.
- `ONBOARDER_LAUNCH_DRYRUN=1 swarmforge/scripts/launch_onboarder.sh <swarm-repo-root>`
  prints the assembled supervisor and reconcile commands and starts nothing —
  useful to confirm the entrypoint resolves before a real start.
- Liveness evidence, all under `.swarmforge/operator/`:
  - `onboarder-supervisor.pid` — the supervisor's own pid file.
  - `onboarder-supervisor.log` — its log, including start/stall/restart
    counts.
  - `onboarder-heartbeat.json` — written by the reconcile poll-loop itself;
    a stale heartbeat is what the supervisor's own restart logic watches
    for.
- If `start_ancillary_services.sh` printed
  `WARN: onboarder failed to start; run './swarm ensure' after fixing.`,
  fix whatever it named and run `./swarm ensure` to retry just the
  ancillaries without restarting the whole swarm.
- Message handling for the Onboarding topic runs inside the Telegram
  front-desk bot's **single poller** — a supervisor with no front desk
  running answers nothing posted to the topic. Verify the front desk is up
  before assuming a silent Onboarder is broken.

## 3. Drive one target end to end

Posting a target's GitHub repo URL into the Onboarding topic opens (or
resumes, if already in flight) a per-target onboarding. It walks five
prerequisite steps in order, then every persisted phase from
`checking-prerequisites` through to `done`:

**Prerequisite steps** (`checking-prerequisites` phase, one at a time):
`toolchain`, `github-access`, `fork-clone`, `target-repo`, `bot-token`. Each
step's message gives the exact command to run on the target host and names
the verification output to paste back; a step only advances on a passing
pasted verification, never a bare claim of "done".

**Persisted phases**, in order: `checking-prerequisites` →
`prerequisites-ready` → `contract-proposed` → `negotiating` →
`contract-agreed` → `prompts-proposed` → `gate-open` → `ready-to-launch` →
`done`.

At `prerequisites-ready`, posting `proceed` surveys the target repo and
proposes an onboarding contract. At `contract-proposed`/`negotiating`, post
`show-me` to see the current contract, `change-this <objection>` to revise
it, or `proceed` to agree it. Once agreed (`contract-agreed`), `proceed`
generates and commits the target's prompts (`prompts-proposed`), then a
further `proceed` runs the build-start gate and, once it opens, posts the
launch handoff message.

For the exact reply-by-reply wording at each phase, see
`docs/tutorials/Onboarding-New-Project.md`'s section 0 — this guide does not
restate it. What shipped and where the code lives (including
`extension/src/tools/onboarder-reconcile.ts`, the reconcile poll-loop and
heartbeat writer) is `docs/explanation/BL-643-non-pipeline-agents-as-a-class.md`.

## 4. Inspect and resume

Each target's state is a JSON file under `.swarmforge/onboarding/`, keyed by
a slug of the normalized target repo URL — re-posting the same URL, even a
trivial variant (trailing slash, `.git`, `http` vs `git@`), resumes the same
onboarding rather than starting a second one. An onboarding can be paused
at any point and resumed later; a restarted supervisor picks the in-flight
state back up from where it left off. Two targets in flight at once are
distinguished by naming the target in a reply when it would otherwise be
ambiguous.

## 5. Recover from a failure

A clone, survey, or contract-propose failure holds the onboarding where it
is with a message ending "Fix the issue and post `proceed` to retry." — fix
whatever it named on the target host and post `proceed`; nothing is lost.

If the supervisor process itself crashes, `onboarder_supervisor.bb` restarts
it with a bounded budget (`ONBOARDER_MAX_ATTEMPTS`, default 5, within a
cooldown window `ONBOARDER_GIVEUP_COOLDOWN_MS`, default 900000 ms). Once
that budget is spent, `onboarder-supervisor.log` shows the give-up and no
further automatic restart happens until the cooldown re-arms it — starting
it again by hand (section 2) is the manual recovery.

## 6. Launch handoff and stop

At `ready-to-launch`, the Onboarder posts the exact launch command
(`./swarm <path> --pack mono-router`) and says: "You run this - I cannot
launch or observe the target host myself. Post \"proceed\" once it has
launched." **The human runs that command themselves, on the target host —
the Onboarder never launches or observes the target swarm.** Posting
`proceed` after that marks the target `done`.

To stop the Onboarder without stopping the rest of the swarm's ancillaries,
run `swarmforge/scripts/stop_ancillary_services.sh`, which touches
`onboarder-supervisor.stop` as a graceful stop marker for the supervised
reconcile poll-loop.
