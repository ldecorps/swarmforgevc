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

To check what creds a given checkout would actually resolve to, without
launching anything:

```sh
swarmforge/scripts/fleet_telegram_creds_cli.bb <project-root>
# {"swarmName":"fes","botToken":"...","chatId":"...","bridgePort":...}
```

## 3. E2E verification procedure (QA runs this against a live bring-up)

1. Follow steps 1–2 above to launch FES as a `mono-rotate` swarm from the
   Windows-side checkout.
2. From a shell that still has the **primary's** `TELEGRAM_BOT_TOKEN`
   exported, confirm the FES front desk resolves and uses its own bot token
   from its fleet creds file (FES's log shows no `409 Conflict` — the
   signature of two pollers sharing one bot token).
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
