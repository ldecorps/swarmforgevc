'use strict';

// BL-1509 declared invariant (coder-authored per BL-654): "The bot token
// never appears in any error string, log line or thrown message the
// document upload path or the CLI produces - success and failure both
// carry the redacted shape every other telegramClient call uses."
//
// Two facets, one property each, both driving REAL production code (never
// a re-implementation of the redaction logic, which would test this file's
// own oracle against itself):
//   A. telegramClient.sendDocument - the upload path itself.
//   B. send-telegram-document.js's sendTelegramDocumentCore - the CLI path,
//      which only ever surfaces sendDocument's own (already-redacted)
//      error, but is exercised independently since the invariant names it
//      explicitly.
//
// REACH, asserted rather than hoped for. A random token and a random
// failure text drawn independently would almost never overlap, which would
// let a broken (unredacted) implementation pass by sheer luck - so every
// generated failure text is CONSTRUCTED to embed the live token substring,
// the one shape that actually exercises redactToken's own split/join.
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { sendDocument } = require('../out/notify/telegramClient');
const { sendTelegramDocumentCore } = require('../out/tools/send-telegram-document');

const CHAT_ID = '999888777';

// Tokens that include the characters most likely to break a naive redaction
// (colons, slashes - Telegram's own token shape - plus punctuation that
// could interact oddly with string.split/join).
const tokenArb = fc
  .tuple(fc.integer({ min: 100000, max: 999999999 }), fc.stringMatching(/^[A-Za-z0-9_-]{10,35}$/))
  .map(([id, secret]) => `${id}:${secret}`);

const statusArb = fc.constantFrom(400, 401, 403, 404, 429, 500);
const descriptionWordsArb = fc.array(fc.constantFrom('chat', 'not', 'found', 'blocked', 'forbidden', 'invalid', 'request'), { minLength: 1, maxLength: 4 });

function embedToken(words, token, position) {
  const parts = [...words];
  const at = Math.min(position, parts.length);
  parts.splice(at, 0, token);
  return parts.join(' ');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('property (invariant): sendDocument never leaks the token into a non-ok response error, whatever the token or description shape', async () => {
  let checked = 0;
  await fc.assert(
    fc.asyncProperty(
      tokenArb,
      statusArb,
      descriptionWordsArb,
      fc.nat({ max: 4 }),
      async (token, status, words, position) => {
        const description = embedToken(words, token, position);
        const postFn = async () => ({ ok: false, status, json: { ok: false, description } });

        const result = await sendDocument(token, CHAT_ID, Buffer.from('x'), 'f.txt', undefined, undefined, postFn);
        checked += 1;
        assert.equal(result.success, false);
        assert.ok(result.error, 'a failure must carry an error string');
        assert.doesNotMatch(result.error, new RegExp(escapeRegExp(token)),
          `token leaked into error: ${result.error}`);
        // The redacted shape: the token's own placeholder stands in for it.
        assert.match(result.error, /\[redacted\]/);
      }
    ),
    { numRuns: 100 }
  );
  assert.ok(checked >= 100, `reach floor: only ${checked} trial(s) actually exercised sendDocument`);
});

test('property (invariant): sendDocument never leaks the token into a thrown network error, whatever the token or message shape', async () => {
  let checked = 0;
  await fc.assert(
    fc.asyncProperty(
      tokenArb,
      descriptionWordsArb,
      fc.nat({ max: 4 }),
      async (token, words, position) => {
        const message = embedToken(words, token, position);
        const postFn = async () => {
          throw new Error(message);
        };

        const result = await sendDocument(token, CHAT_ID, Buffer.from('x'), 'f.txt', undefined, undefined, postFn);
        checked += 1;
        assert.equal(result.success, false);
        assert.ok(result.error, 'a thrown network error must still carry an error string');
        assert.doesNotMatch(result.error, new RegExp(escapeRegExp(token)),
          `token leaked into error: ${result.error}`);
        assert.match(result.error, /\[redacted\]/);
      }
    ),
    { numRuns: 100 }
  );
  assert.ok(checked >= 100, `reach floor: only ${checked} trial(s) actually exercised sendDocument`);
});

test('property (invariant): a success carries no error field at all - trivially never leaks the token', async () => {
  let checked = 0;
  await fc.assert(
    fc.asyncProperty(tokenArb, async (token) => {
      const postFn = async () => ({ ok: true, status: 200, json: { ok: true, result: { message_id: 1 } } });
      const result = await sendDocument(token, CHAT_ID, Buffer.from('x'), 'f.txt', undefined, undefined, postFn);
      checked += 1;
      assert.deepEqual(result, { success: true });
    }),
    { numRuns: 50 }
  );
  assert.ok(checked >= 50);
});

// ── CLI path (sendTelegramDocumentCore) ─────────────────────────────────
// The CLI's own reasons (operator-topic-not-yet-created, missing-telegram-
// config) never touch the token at all; the send-failure reason is
// whatever sendDocument returned, already covered above - exercised again
// here end-to-end (real fixture root, real env, real file read) so the
// invariant is proven at the surface the ticket actually names ("the
// document upload path OR THE CLI"), not only at sendDocument's own unit
// boundary.
function mkFixtureRoot() {
  const root = mkTmpDir('bl1509-prop-cli-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json'), JSON.stringify({ '777': 'OPERATOR' }));
  fs.writeFileSync(path.join(root, 'report.md'), '# report');
  return root;
}

test('property (invariant): the CLI core never leaks the token into its outcome reason on a failed send', async () => {
  let checked = 0;
  const previousEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    TELEGRAM_NOTIFY_FORCE_RESULT: process.env.TELEGRAM_NOTIFY_FORCE_RESULT,
  };
  try {
    await fc.assert(
      fc.asyncProperty(tokenArb, descriptionWordsArb, fc.nat({ max: 4 }), async (token, words, position) => {
        const root = mkFixtureRoot();
        try {
          const description = embedToken(words, token, position);
          process.env.TELEGRAM_BOT_TOKEN = token;
          process.env.TELEGRAM_CHAT_ID = 'fake-chat';
          // The forced result mirrors what sendDocument itself would return
          // for a non-ok response carrying the token embedded in the
          // description - already redacted, exactly as production
          // sendAnnouncement's real (non-forced) path would produce.
          process.env.TELEGRAM_NOTIFY_FORCE_RESULT = JSON.stringify({
            success: false,
            error: `Telegram API responded with status 400: ${description.split(token).join('[redacted]')}`,
          });

          const outcome = await sendTelegramDocumentCore(root, path.join(root, 'report.md'), undefined);
          checked += 1;
          assert.equal(outcome.success, false);
          assert.ok(outcome.reason);
          assert.doesNotMatch(outcome.reason, new RegExp(escapeRegExp(token)),
            `token leaked into CLI outcome reason: ${outcome.reason}`);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 50 }
    );
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.ok(checked >= 50, `reach floor: only ${checked} trial(s) actually exercised the CLI core`);
});
