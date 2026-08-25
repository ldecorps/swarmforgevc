# BL-439: Bringing Up the FES Second Swarm (mono-rotate, own Telegram identity)

**Stands up a real second swarm against `free-email-scanner` (the "FES"
fleet guinea pig) as a `mono-rotate` pack, launched from the Windows-side
checkout, with its own bot/group so it never steals the primary swarm's
Telegram inbound.**

This is the fleet epic's (BL-435) real-world end-to-end acceptance: it turns
"fleet of one, in theory" into "fleet of two, for real." Two of its four
acceptance behaviours — own-token creds resolution, and distinct-identity
rendering in the fleet console — are pinned as executable scenarios in
`specs/features/BL-439-fes-second-swarm-bringup.feature`, driven directly
against `fleet_telegram_creds_cli.bb` and `fleet-console.ts`. The other two
— the real Windows-side launch, and the live Telegram no-message-theft
round-trip — are inherently live and are the procedure below.

## Why mono-rotate, not a 2-pack or full pack

FES runs on a 15GB box that OOM-crashed under a full swarm. `mono-rotate`
(BL-448, `swarmforge/packs/mono-rotate.conf`) is the lightest pipeline
config: **one** resident agent process rotates through every pipeline role
in turn (specifier → coder → cleaner → architect → hardender → documenter →
QA), instead of one long-lived process per role. Full gates are preserved
(acceptance, coverage, mutation/no-survivors, CRAP<=6, QA final) — the
memory saving comes only from having a single resident process, never from a
lighter gate. The coordinator is still separately auto-provisioned and is
not part of the rotation.

### `./swarm ensure` respects the dormant roles (BL-571)

Running `./swarm ensure` against this pack is safe: it leaves the five
deliberately dormant middle roles alone rather than repairing them into
existence.

That was not always true. The launcher's `is_sequential_dormant` treats
`rotation sequential` (what `mono-rotate.conf` declares) and `rotation router`
as the same single-resident topology, but ensure's own check matched `router`
alone — so on this pack, and only on this pack, ensure read the five dormant
roles as broken panes and repaired them. The report said **healed** where the
truth was **over-provisioned**, and it started five extra agent processes on
exactly the 15GB box this pack exists to protect.

Ensure now recognises the topology by every value the launcher accepts, so the
"one resident process" promise above holds through a repair pass. Nothing about
how you invoke it changed. Dormant roles still keep their worktree, their
`roles.tsv` entry and a pre-generated launch script — only the process is
absent, until the resident rotates onto that role itself.

If you see ensure report repairs for `cleaner`, `architect`, `hardender`,
`documenter` or `QA` on a `mono-rotate` pack, that is the old behavior: check
that the checkout carries BL-571 before trusting the report.

## 1. Launch from the Windows-side checkout

FES's target repo lives on `/mnt/c` (`C:\Users\...\free-email-scanner`), and
Linux-side tmux sockets are unreliable against `/mnt/c` paths — launch from
the Windows-side swarmforge checkout, not from a WSL2/Linux-side one:

```sh
./swarm <path-to-free-email-scanner> --pack mono-rotate
```

## 2. Its own bot and group — never the primary's

FES has its own Telegram bot and its own supergroup, with per-swarm creds
resolved from its own fleet creds file under `~/.swarmforge/fleet/fes/` (the
`SWARMFORGE_FLEET_HOME`-rooted layout `fleet_telegram_creds_lib.bb`
resolves, BL-436). This is what makes the separation proof possible even
when a shell has the primary's `TELEGRAM_BOT_TOKEN` exported: fleet creds
take priority over the environment fallback for a swarm with its own file.

**Provision that creds file BEFORE launching** (BL-622: a swarm that is
neither the recorded primary root nor holds its own creds file keeps its
front desk down with a loud refusal — never a launch that silently
inherits whatever the shell happens to export):

```sh
node extension/out/tools/provision-onboarding-telegram-channel.js \
  <fes-repo-path> <fes-bot-token> <fes-bot-username> <host-secrets-file-path> fes [bridge-port]
```

See `docs/tutorials/Onboarding-New-Project.md` for the full one-bot-per-
target rationale and prerequisites (BotFather, a Topics-enabled group, and
adding the bot as an admin).

To check what creds a given checkout would actually resolve to, without
launching anything:

```sh
swarmforge/scripts/fleet_telegram_creds_cli.bb <project-root>
# {"swarmName":"fes","botToken":"...","chatId":"...","bridgePort":...,"refused":false,"reason":null}
```

## 3. E2E verification procedure (QA runs this against a live bring-up)

1. Follow steps 1–2 above to launch FES as a `mono-rotate` swarm from the
   Windows-side checkout — with its own fleet creds file already provisioned
   via `provision-onboarding-telegram-channel.js` (step 2 above), never by
   exporting the primary's `TELEGRAM_BOT_TOKEN` into the launching shell
   (BL-622: a swarm without its own creds keeps its front desk down with a
   loud refusal instead of silently inheriting the primary's token).
2. Confirm the FES front desk resolves and uses its own bot token from its
   fleet creds file, even from a shell that still happens to carry the
   primary's `TELEGRAM_BOT_TOKEN` (FES's log shows no `409 Conflict` — the
   signature of two pollers sharing one bot token, and no BL-622 refusal
   line either — a provisioned creds file always wins wholesale).
3. Send a message to each bot and confirm only the owning swarm consumes it
   — neither swarm's inbound is stolen by the other.
4. Open the fleet console (`extension/src/tools/fleet-console.ts`, reading
   each swarm's published `status.json` per BL-437) and confirm the primary
   and `fes` render as two distinct swarms.

Steps 2 and 4's underlying logic — creds resolution and status.json
enumeration — are also exercised in-process by the executable feature
scenarios; this procedure is what proves it against a real second swarm,
which no in-process test can stand up.

## If the fleet layer doesn't separate

If step 2 or 3 fails against a genuine bring-up (message theft, or FES
falling back to the primary's token), that is a fleet-layer defect in
BL-436/437, not a gap in this runbook — file it with the observed log
evidence rather than patching around it here. Do not close the fleet epic
(BL-435) until this bring-up's live procedure passes; green unit slices for
BL-436/437 alone are not proof the fleet carries two swarms.
