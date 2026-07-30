# INTAKE — One clear way to redeploy Telegram code changes

**Date:** 2026-07-30  
**Urgency:** medium (operator DX; blocks confidence when shipping verbs / ask fixes)  
**Type:** feature / operator tooling  
**Surface:** Cursor Remote redeploy + front-desk lifecycle  
**Source:** human via Cursor (2026-07-30)

## Human ask (verbatim intent)

It is not clear how to redeploy changes to Telegram — for example new slash
verbs. There should be an obvious, documented, working path so a code change
on disk actually becomes the live Telegram process(es).

## Why this hurts

Today there are **three** Telegram-adjacent runtimes with **different** bounce
paths, and the phone verbs do not name them clearly:

| Live process | What it owns | How it is bounced today |
|--------------|--------------|-------------------------|
| **Cursor bridge** | Cursor Remote slash verbs (`/pilot`, `/redeploy`, …), Let's Talk text pairing | `/redeploy` or `/bounce bridge` → `redeploy_cursor_bridge.sh` (compile + restart cursor bridge) |
| **Mini App headless bridge** | `/lets-talk` HTTP | `/redeploy miniapp` |
| **Front desk** (bridge + bot) | Approvals, role topics, **BL-607 `role_ask` delivery**, reply-outbox → Telegram | **No** Cursor Remote verb. Swarm start / `./swarm ensure` / `launch_front_desk.sh` |

So:

- New **verbs** → `/redeploy` is correct (once understood).
- Fixes that live on the **front-desk / shared outbox relay** path (e.g. the
  BL-607 `roleQuestion` strip bug) are **not** picked up by `/redeploy` alone —
  the human can Confirm redeploy, see success, and still run stale front-desk
  code.
- `/compile` alone does not restart anything.

The human should not need a mental model of three supervisors to ship a Telegram
change.

## Desired outcome

1. **One operator-facing story** (how-to + `/help` lines) that answers:
   “I changed Telegram-related extension code — what do I type?”
2. **Verbs (or verb args) that match the story**, e.g. something in this shape
   (specifier picks exact names; do not invent three synonyms):
   - redeploy **Cursor Remote** (today’s `/redeploy`)
   - redeploy **Mini App** (today’s `/redeploy miniapp`)
   - redeploy **front desk** (missing — compile + bounce front-desk
     supervisor / bridge+bot, reload `swarm.env` like other redeploy paths)
   - optionally a **`/redeploy telegram` / `/redeploy all`** that does the
     union needed after a shared `extension/` change (cursor + front desk ±
     miniapp), with a clear status reply naming what restarted
3. Soft-confirm tier (same as `/redeploy` today). Wrong topic / non-principal
   still no-ops.
4. Log tail already partially exists (`/log redeploy|bridge`); extend or
   document so the human can see compile + which child came back.

## Acceptance sketch

- How-to (BL-698 / BL-702 family or a short sibling) states the matrix above
  and the exact verb(s) to use for: new Cursor Remote verb; front-desk bot /
  outbox relay change; Mini App change; shared change touching more than one.
- Cursor Remote `/help` lists those redeploy forms.
- After Confirm, a front-desk-targeted redeploy leaves a new front-desk bot /
  bridge build fingerprint (or documented equivalent) live — not only the
  cursor bridge.
- Unit / integration pins: parse + confirm routing for the new arg(s); exec
  invokes the real launch/stop scripts (or the same helpers `ensure` /
  `launch_front_desk.sh` already own) — no second unsupervised nohup path.

## Related

- `docs/how-to/BL-698-telegram-cursor-operator-commands.md`
- `docs/how-to/BL-702-operator-confirm-env-reload.md`
- `swarmforge/scripts/redeploy_cursor_bridge.sh`
- `swarmforge/scripts/launch_front_desk.sh` / front-desk supervisor
- Sibling defect intake:
  `backlog/INTAKE-bl607-role-ask-outbox-strips-roleQuestion.md`
  (fixing that fix without a front-desk bounce leaves the human thinking
  redeploy “did nothing”)

## STEERING / scope note

This is **operator lifecycle tooling** (redeploy clarity), not new Telegram
product/UI (boards, topics, mini-app pages). Prefer extending the existing
`/redeploy` family over inventing a parallel console surface. Align with the
2026-07-30 phone-PWA freeze: do not grow Telegram UX; do make shipping and
verifying Telegram **infrastructure** changes operable from the phone.

## Non-goals

- Redesigning Cursor Remote vs front-desk architecture
- Auto-redeploy on every `extension/` save
- Android overlay bubble APK install from Telegram
