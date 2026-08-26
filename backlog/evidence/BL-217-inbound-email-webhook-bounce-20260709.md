# BL-217 QA bounce — svixSignature has no timestamp/replay check

## Failing command
```
cd extension && node -e "
const { verifySvixSignature } = require('./out/notify/svixSignature');
const crypto = require('crypto');
const SECRET = 'whsec_' + Buffer.from('bl-225-fake-fixture-seed').toString('base64'); // BL-225: runtime-built, not a committed literal
function sign(id, timestamp, rawBody, secret = SECRET) {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = id + '.' + timestamp + '.' + rawBody;
  return 'v1,' + crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
}
const rawBody = '{\"type\":\"email.received\"}';
const staleTimestamp = '1614265330'; // 2021-02-25 - a captured request replayed years later
const headers = { svixId: 'msg_replayed', svixTimestamp: staleTimestamp, svixSignature: sign('msg_replayed', staleTimestamp, rawBody) };
console.log('Replaying a request signed on', new Date(Number(staleTimestamp) * 1000).toISOString());
console.log('verifySvixSignature result:', verifySvixSignature(headers, rawBody, SECRET));
"
```

Corroborating check — the existing test suite itself demonstrates this with no
staleness assertion anywhere in the file:
```
grep -n "svixTimestamp\|timestamp" extension/test/svixSignature.test.js
```
Every test uses the same fixed, already-years-stale `svixTimestamp: '1614265330'`
and none assert that an old timestamp is rejected.

## Commit hash tested
`ddc2e2650c` (documenter's handoff, `BL-217-inbound-email-webhook`), merged into
QA at `2983509774`.

## First error excerpt
```
Replaying a request signed on 2021-02-25T15:02:10.000Z
verifySvixSignature result: true
```
A signature computed over a `svix-timestamp` from 2021 still verifies today —
`verifySvixSignature` (extension/src/notify/svixSignature.ts) checks only the
HMAC over `<id>.<timestamp>.<rawBody>`; it never compares `svixTimestamp`
against the current time. `handleInboundEmailWebhook`
(extension/src/notify/recertInboundWebhook.ts) calls only
`verifySvixSignature` and proceeds straight to parse/commit on `true` — no
caller anywhere in the chain checks staleness either, even though
`HandleInboundEmailWebhookDeps.nowIso` is already injected and unused for
this purpose.

## Failure class
`behavior`

## Expected vs observed
Expected: per the ticket's own security section, "an unauthenticated request
must never create a proposal" — Svix's own verification guide (linked
directly in this file's header comment) covers timestamp/tolerance-window
checking as part of "verifying payloads" precisely so a captured,
validly-signed request cannot be resubmitted later to create unwanted
writes. A replayed request is not a fresh, authentic delivery from Resend;
it should be rejected the same way an unsigned/forged one is
(webhook-02's own intent).

Observed: `verifySvixSignature` accepts any request whose HMAC matches,
regardless of how old `svixTimestamp` is — confirmed live above with a
2021-dated signature. Nothing in `handleInboundEmailWebhook`'s call chain
checks `svixTimestamp` against `deps.nowIso`. Impact is bounded (per
hardener's own note on commit `9d7e329`: proposals are never auto-applied,
so a replay pollutes the specifier's review queue rather than corrupting
the acceptance contract directly), but it is a real, reproducible gap
against the ticket's own stated intent for this specific write path, not a
hypothetical. Hardener flagged this explicitly (note to QA, commit
`9d7e329`) rather than fixing it, correctly leaving the call to QA since
it's new behavior, not hardening.

Fix: in `verifySvixSignature` (or its caller, since `nowIso` is already
available there), reject when `Math.abs(nowMs/1000 - Number(svixTimestamp))`
exceeds a tolerance window (Svix's own docs suggest ~5 minutes) — pure,
deterministic, no new clock/network dependency, consistent with the
ticket's existing "pure over provided inputs, no real timers in tests"
constraint. Add a test asserting a stale timestamp is rejected even with an
otherwise-correct signature.
