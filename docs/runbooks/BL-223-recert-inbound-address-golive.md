# BL-223: Wiring the Phone Recert Inbound Address Live

**Two operator steps in the Resend dashboard turn on real inbound delivery
for the phone recertification flow — no DNS/MX records to add.**

Code-side, `recert@tolokarooo.resend.app` now flows end-to-end:
`swarmforge/swarmforge.conf`'s `recert_email_to` →
`extension/src/docs/recertificationStore.ts`'s `computeRecertBatch` →
`recert-batch.json` → `pwa/app.js`'s mailto: composition. This runbook is
the remaining *ops* half: pointing that address at the already-built BL-217
serverless receiver (`extension/src/notify/recertInboundWebhook.ts`).

## 0. The BL-217 serverless receiver now exists (BL-288)

`api/recert-webhook.js` (Vercel Node function, `vercel.json` at the repo
root) wraps `extension/src/notify/recertInboundWebhook.ts`'s already-tested
core end to end — this repo can now be deployed to Vercel to obtain the
endpoint URL step 2 below points the Resend route at. Set these serverless
environment variables in the Vercel project (never committed to the repo):

- `RECERT_WEBHOOK_SECRET` — the shared Svix/Resend signing secret
  (`HandleInboundEmailWebhookDeps.secret`).
- `RECERT_SENDER_ALLOWLIST` — comma-separated allowed sender email(s)
  (BL-248, fail-closed: empty/missing rejects every sender).
- `RECERT_GITHUB_OWNER`, `RECERT_GITHUB_REPO` — the repo a committed
  proposal writes to via the GitHub Contents API.
- `RECERT_GITHUB_BRANCH` — defaults to `main` if unset.
- `RECERT_GITHUB_TOKEN` — a GitHub token with contents-write access to that
  repo (never committed).

## 1. Confirm the receiving domain

In the [Resend dashboard](https://resend.com/domains), under **Receiving**,
confirm `tolokarooo.resend.app` is present and active. This is a
Resend-managed domain — Resend already owns its MX records, so there is
nothing to add on the operator's side.

## 2. Route inbound mail to the BL-217 receiver

Configure the Resend Inbound webhook/route so mail addressed to anything on
`tolokarooo.resend.app` (in practice, just `recert@tolokarooo.resend.app`)
POSTs to the BL-217 serverless function's deployed HTTPS endpoint (Vercel
Functions, Node runtime). Point the route at that endpoint's URL and set
the shared signing secret to match `HandleInboundEmailWebhookDeps.secret`
in the function's own deployment environment — never committed to the
repo, per the constitution's secrets rule.

**Also required (BL-248): set `HandleInboundEmailWebhookDeps.senderAllowlist`** in
that same deployment environment, to the email address(es) the operator
actually sends recertification replies from. This gate is **fail-closed** —
an empty or missing allowlist rejects every sender, so the receiver stays
inert (every inbound recert email 403s) until this is set, even with a
correct signing secret.

## 3. Verify (QA e2e procedure)

- From the phone, tap a recertification action (confirm/update/delete).
  Confirm the mail client composes to `recert@tolokarooo.resend.app` — not
  the old `.invalid` placeholder — and the email sends without bouncing.
- Confirm a signed inbound email reaches the BL-217 receiver and queues
  exactly one proposal for specifier review.
- Confirm a signed email from a sender **not** on the allowlist gets a 403
  and creates no proposal (BL-248); confirm the same email from an
  allowlisted sender succeeds.
- Confirm an **unsigned** POST to the same endpoint creates no proposal
  (`recertInboundWebhook.ts`'s signature/freshness gate — BL-223 does not
  weaken it; a real address changes only where mail is delivered from, not
  the receiver's own auth).

## Later, optional: a branded custom domain

Not required for go-live. If the operator later wants
`recert@inbound.musicalsifu.com` instead:

1. Add a subdomain (e.g. `inbound.musicalsifu.com`, not the bare domain, so
   it never conflicts with musicalsifu.com's existing mail) and its MX
   record pointing at Resend Inbound, then verify the domain in the Resend
   dashboard.
2. Change `swarmforge/swarmforge.conf`'s `recert_email_to` to the new
   address. That is the **entire** code-side change — the PWA never
   hardcodes the address, so nothing else needs touching.
3. Re-point the Resend Inbound route (step 2 above) at the same BL-217
   endpoint for the new domain.
