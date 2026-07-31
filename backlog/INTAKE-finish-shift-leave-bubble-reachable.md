# Raw intake — Finish-shift script: put the swarm to bed, leave Bubble reachable

Status: new intake, not minted. Capture only (human via Let's Talk / Cursor
2026-07-30 after day-shift-end killed the bridge and Bubble showed Cloudflare
530 / Error 1033).

Related
- `backlog/paused/BL-716-bubble-lets-talk-tunnel-hostname-dns.yaml` — DNS /
  unreachable-host UX when the tunnel or origin is bad; this intake is about
  **not killing** the phone path on ordinary bedtime.
- Day-shift-end / `stop-swarm.sh` today always runs `stop_ancillary_services`
  (front desk = bridge + bot, tunnels, babysitter, operator, …) then kills
  agents/handoffd. That is why Bubble looked “ready” while the origin was gone.

## Goal

Introduce an explicit **finish-shift** (bedtime) path that stops the swarm’s
token burn but **leaves Bubble’s host path up**: bridge + Cloudflare tunnel
(and Telegram front desk as needed so the phone can still reach the host).

Keep **full stop-swarm / kill-all** as the true lights-out verb.

## Problem

- Ordinary “swarm goes to bed” used the full stop stack.
- That killed the Cursor / Let’s Talk bridge and related ancillaries.
- Bubble on the phone was not killed, but turns failed with Cloudflare tunnel
  / origin errors (530 / 1033) — reads as “app dead” when only the host path
  was torn down.
- Operators want overnight phone reachability without keeping the whole pack
  burning.

## Why this matters

- Phone is the live control surface; bedtime should not look like Bubble death.
- Separating “pack sleeps” from “phone path dies” matches how humans think
  about a shift end.
- Avoids burning another debugging loop every evening on a predictable stop.

## Requested outcome

### Slice 1 — Finish-shift (reachable Bubble)

1. A named script / operator verb: **finish-shift** (name bikeshed OK;
   intent is bedtime for the pack).
2. Stops (at least): swarm agents, handoffd, babysitter (so it cannot
   relaunch seats), disposable operator LLM burn. Same clean agent teardown
   posture as today’s stop where it overlaps.
3. **Leaves up**: Let’s Talk / Cursor bridge, the Cloudflare (or equivalent)
   tunnel that publishes it, and Telegram front desk if that is what owns
   bridge lifetime today.
4. On the phone after finish-shift: no Cloudflare 530/1033 solely because
   bedtime ran; base URL still reaches the host bridge.
5. Turns may honestly report “swarm asleep / no resident” if no agent is
   bound — that is OK for slice 1; must not look like tunnel death.
6. **Full stop-swarm** (and emergency kill-all) remain available and still
   tear down ancillaries including bridge/tunnels when the human wants
   lights-out.
7. Day-shift-end / night cron bedtime should call **finish-shift**, not full
   stop, unless config says lights-out.
8. Docs: one short how-to — finish-shift vs stop-swarm; what stays up; how
   to full-stop when traveling / host off.

### Slice 2 — Talkable overnight (optional, later)

- Keep a Cursor Let’s Talk agent (or equivalent) awake so voice still answers
  while the pack sleeps.
- Out of slice 1 unless the human promotes it in the same mint.

## Acceptance shape to refine

1) After finish-shift: no swarm agent panes / no handoffd; bridge listens;
   public tunnel URL returns non-530 to the bridge.
2) Bubble can open Let’s Talk without Cloudflare tunnel-origin error.
3) A turn either reaches a living agent or returns a clear “swarm asleep”
   style failure — not DNS/530 confusion.
4) Full stop-swarm after that still kills bridge + tunnel; Bubble then fails
   closed as today.
5) Cron / day-shift-end bedtime uses finish-shift by default.
6) When the public URL changes on revive, Bubble can discover the new
   pairing without hunting host logs (see discovery options below).

## Making a new tunnel URL discoverable by the app

Today the host Telegram-notifies the new quick-tunnel URL; Bubble only has
prefs / Downloads pairing mirror and does not consume that notify. So revive
is invisible until manual paste.

Options (prefer durable):
1. **Stable hostname** — named Cloudflare tunnel so the URL stops changing.
2. **Deep link / App Link** — tunnel notify becomes a one-tap
   `swarmforge-bubble://pair?…` (or HTTPS) that writes pairing prefs.
3. **Fixed discovery document** — publish current base URL to a stable HTTPS
   place Bubble can poll on 530/DNS failure (Pages / named endpoint); keep
   token handling safe.
4. **Failure UX** — on 530/1033, prompt “Refresh pairing” instead of raw JSON.

Near-term while quick tunnels remain: (2). Production: (1). Complementary to
BL-716.

## Out of scope

- Fixing stale trycloudflare hostname refresh (BL-716) — complementary; share
  discovery design with that ticket.
- Hey-bubble / barge-in / silence-to-passive intakes.
- Closing-ceremony / morning briefing (BL-658 family).
- Renaming Telegram `/expedite` (unrelated vocabulary).

## Suggested type / priority hint for mint

- type: feature (operator lifecycle)
- Not offline expeditor. Queue-jump only if the human asks.
- Specifier first: define the keep-vs-kill matrix explicitly so coder does
  not guess which ancillaries stay.
