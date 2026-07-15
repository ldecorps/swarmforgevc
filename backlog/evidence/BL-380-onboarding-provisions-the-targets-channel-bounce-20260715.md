# BL-380 QA bounce — 2026-07-15

## Failing command
```
cd extension
node -e "
const { getTelegramUpdates } = require('./out/notify/telegramClient');
const { provisionTelegramChannel } = require('./out/onboarding/telegramChannelProvisioning');

const failingPostFn = async () => ({ ok: false, status: 401, error: 'Unauthorized' });

async function main() {
  const adapters = {
    getUpdates: async () => (await getTelegramUpdates('bad-token', 0, 0, failingPostFn)).updates,
    createNegotiationTopic: async () => ({ success: true, messageThreadId: 42 }),
    persistChannel: () => {},
    persistBotToken: () => {},
  };
  console.log(JSON.stringify(await provisionTelegramChannel('sfvc_target_bot', adapters), null, 2));
}
main();
"
```

## Commit hash
`9bc974e117b561ff4e1a91ee090a3c77cdf643f3` (QA's merge of documenter
`83d4bec04e` / BL-380, into `swarmforge-QA`).

## First error excerpt
```
{
  "instructions": { ... },
  "ready": false
}
```
No `error` field, and byte-identical to the legitimate "human hasn't finished
creating the group yet" outcome (see
`telegramChannelProvisioning.test.js`'s own "reports not ready ... when the
group has not been detected yet" test, which asserts this exact same shape
for that case).

## Failure class
`behavior` — unit suite green (3769+ tests), acceptance for this feature
green (5/5). The gap is that a Telegram API FAILURE (bad/revoked bot token,
network error, rate limit — anything `callTelegramApi` reports as
`success:false`) is silently collapsed into the same `{ready:false}` result
as the legitimate "the human hasn't finished the manual setup step yet"
case:

- `extension/src/tools/provision-onboarding-telegram-channel.ts:43`'s
  `buildAdapters` wires `getUpdates: async () => (await
  getTelegramUpdates(botToken, 0, 0)).updates` — it reads only `.updates`
  off `GetUpdatesResult` and discards `.success`/`.error` entirely.
- `extension/src/onboarding/telegramChannelProvisioning.ts`'s
  `ChannelProvisioningAdapters.getUpdates` is typed `() =>
  Promise<TelegramUpdate[]>` — there is no seam for the adapter to report a
  fetch failure at all, so `decideChannelDetection([])` (empty array either
  way) can never distinguish "zero updates because nothing has happened
  yet" from "zero updates because the API call itself failed".

This is precisely the failure-mode family the engineering article names
three separate times as a recurring, costly defect: "never collapse a
FAILURE into the same signal as a legitimate/deliberate outcome" (see
BL-215/`daemon_alarm_lib.bb`, BL-333/BL-345 starvation-alarm, BL-389's
delivered/dropped/failed three-way). Here a human who types a stale or
mistyped bot token (a copy-paste from BotFather is exactly the kind of
one-character transcription error this step invites) reruns onboarding
forever and sees an unchanging, uninformative `{"ready": false}` — nothing
tells them the token itself is the problem, so they re-check the group/
Topics/admin setup they already did correctly, indefinitely.

The sibling adapter in the SAME module,
`createNegotiationTopic`, already gets this right — its outcome carries
`success`/`error` and `provisionTelegramChannel` surfaces
`topic.error` on the returned outcome (see the "reports the failure ...
when opening the topic fails" test). `getUpdates` is the one adapter in
this ticket's own surface that does not follow that established, tested
pattern in the same file.

## Expected vs observed
Expected: a `getUpdates` fetch failure (bad token, network error) is
distinguishable from "no updates yet" — e.g. an `error` field on the
outcome, mirroring how `createNegotiationTopic`'s own failure is already
surfaced. Observed: both cases produce the identical `{ready: false}` with
no error information, so the human running onboarding cannot tell a broken
setup from a broken token.
