# ARCHIVED — drained by specifier 2026-08-26

Disposition: split into BL-1151 (one email per episode) +
BL-1154 (build-stale vs crash give-up budget).

---

# INTAKE — Stop recurring "front desk bridge has given up restarting" emails

**Source:** human via Cursor / Gmail screenshot, 2026-08-26 ~09:37 BST  
**Surface:** `swarmforge/scripts/front_desk_supervisor.bb` give-up escalation
(`escalate-gave-up!` → `daemon-alarm-lib/send-configured-email!`), state in
`.swarmforge/operator/front-desk-escalation-alarm.json`, child policy in
`front_desk_supervisor_lib.bb` (incl. BL-1088 give-up cooldown). Log:
`.swarmforge/operator/front-desk-supervisor.log`.

Status: **new intake, not minted.** Specifier: mint and spec (defect /
reliability). Prefer a fix that stops the mailbox spam **and** addresses
why the bridge keeps hitting give-up — not “email less while the desk stays
down forever” alone.

## Why this is in front of you

Human is receiving **the same email every few minutes** (observed ~every
15–16 minutes: 09:02, 09:18, 09:34 on 2026-08-26):

> Subject: `SwarmForge: front desk bridge has given up restarting`  
> Body: bridge stopped and gave up after 5 attempt(s) — needs a human;
> check `front_desk_supervisor.bb` / `front-desk-supervisor.log` and
> restart by hand.

That cadence matches the default **`FRONT_DESK_GIVEUP_COOLDOWN_MS` =
900000** (15 min): give-up → escalate email → cooldown elapses →
`:re-armed` with a fresh attempt budget → burn budget again → give-up →
**email again**. When status leaves `gave-up`, `escalate-gave-up!`
resets `{armed?: false, …}`, so delivery-based arming (BL-370 / BL-345)
does **not** suppress the next cycle’s mail.

Human ask (locked): **fix this recurring issue** — the repeating email
is the complaint; a one-shot “needs human” that re-mails every cooldown
without new information is not useful.

## Goal

1. **One actionable human signal per incident**, not a metronome every
   give-up cooldown while the same outage continues.
2. **Recover or stay quiet:** either the bridge/bot become healthy without
   needing a human each cycle, or the human gets **one** clear escalate
   until a real recovery (or an explicit human restart / park), with no
   duplicate mail for the same unbroken failure episode.
3. Investigate and close the **underlying** reason the bridge keeps
   exhausting its restart budget on this host (logs show heavy
   `build-stale` detect/restart churn on healthy children around the same
   window — do not ignore that as a possible attempt-budget burner).

## Preferred shape (specifier may refine)

Alarm policy (pick a coherent contract):

- Keep escalation **armed across cooldown re-arms** until the child is
  observably healthy for a grace window (or human clears / park /
  supervisor restart), **or**
- Send at most one email per `(spec-key, give-up episode)` with a long
  re-notify floor (hours, not 15 minutes), **or**
- Demote repeat cycles to log / Telegram once, email only on first give-up
  of an episode.

Root / interaction (include if evidence supports):

- Healthy **build-stale** restarts must not consume the crash give-up
  budget the same way as crashes (or must reset attempts when the restart
  was a voluntary stale-build roll).
- If something else is crash-looping the bridge, name and fix that; the
  email change alone must not hide a permanently dead desk.

## Out of scope

- Silencing unrelated swarm emails (master-checkout drift, etc.).
- Removing give-up / bounded restart entirely.
- Changing Resend / `onboarding@resend.dev` branding.

## Related

- BL-370 — give-up escalation email (delivery-based arming)
- BL-1088 — given-up child stays down for whole cooldown (then re-arms)
- BL-582 / build-stale supervisor restarts onto fresh Node build
- `front_desk_supervisor.bb` `escalate-gave-up!`, `giveup-config`
- Live: Gmail thread “front desk bridge has given up restarting”;
  ~15 min spacing; human 2026-08-26

## Acceptance sketch

- Feature: while bridge remains in a continuous give-up → cooldown →
  re-arm → give-up loop with no healthy recovery, the human receives
  **at most one** escalation email for that episode (or one per long
  re-notify floor — named in the feature), not one per cooldown.
- Feature: a later **new** episode after a real healthy period may email
  again.
- Feature / evidence: root or interaction that was burning the 5-attempt
  budget on this host is identified and either fixed or explicitly
  deferred with a written reason (build-stale attempt accounting called
  out if still guilty).
- Property/unit: leaving `gave-up` for `:re-armed` without a healthy
  grace does not reset escalation arming in a way that re-opens email on
  the next give-up of the same episode.
