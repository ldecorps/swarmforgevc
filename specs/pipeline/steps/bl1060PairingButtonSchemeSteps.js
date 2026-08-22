'use strict';

// BL-1060: step handlers for "A Telegram button carries a URL Telegram will
// accept".
//
// Every scenario drives the REAL compiled builders from
// extension/out/concierge/residentSpyTunnelNotify, and scenario 04 drives the
// REAL notifier against a fake Bot API that enforces the same rule the live
// one does. Nothing here re-states the accepted scheme list: it comes from the
// one shared checker (extension/test/helpers/telegramButtonUrlScheme.js) that
// the unit and property suites also use.
//
// The scenarios pin the SCHEME rather than an identifier on purpose. Both
// original tests asserted the button equalled buildBubblePairingDeepLink(live)
// and passed forever while every live call returned "Unsupported URL
// protocol" - the identifier was right and the kind of value was wrong.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach } = require('node:test');

const FEATURE = 'A Telegram button carries a URL Telegram will accept';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT = path.join(REPO_ROOT, 'extension');
const {
  buildBubblePairingDeepLink,
  buildResidentSpyTunnelUrls,
  buildResidentSpyTunnelTopicButtons,
  buildResidentSpyTunnelPrivateWebAppButtons,
} = require(path.join(EXT, 'out', 'concierge', 'residentSpyTunnelNotify'));
const { notifyResidentSpyTunnelUrl } = require(path.join(EXT, 'out', 'tools', 'notify-resident-spy-tunnel'));
const { RESIDENT_SPY_SUBJECT_ID, RESIDENT_SPY_TOPIC_NAME } =
  require(path.join(EXT, 'out', 'tools', 'telegramTopicDecisions'));
const {
  ACCEPTED_BUTTON_URL_SCHEMES,
  findButtonUrlSchemeViolations,
  describeViolations,
} = require(path.join(EXT, 'test', 'helpers', 'telegramButtonUrlScheme'));

const BASE = 'https://foo.trycloudflare.com';
const TUNNEL_TOKEN = 'abc123';
const LIVE_URL = `${BASE}/resident-spy?bearer=${TUNNEL_TOKEN}`;
// The URL the topic already carries before the rotation. Scenario 04 says
// "for a ROTATED tunnel URL", and a rotation by definition has a previous
// message to edit - without it the notifier POSTS a new one and reports
// "posted", which would make "the topic message is edited" fail for a reason
// that has nothing to do with the scheme.
const PREV_LIVE_URL = 'https://old-tunnel.trycloudflare.com/resident-spy?bearer=stale000';
const BOT_TOKEN = '123456:test-bot-token';
const CHAT_ID = '999888777';
const PRINCIPAL_ID = '42424242';
const TOPIC_ID = 777;

// Explicit known values per the Scenario Outline handler rule: a surface or a
// mini app the handlers do not know is a hard failure, never a passthrough.
const KNOWN_SURFACES = new Map([
  ['topic', (urls) => buildResidentSpyTunnelTopicButtons(urls)],
  ['private DM', (urls) => buildResidentSpyTunnelPrivateWebAppButtons(urls)],
]);

// A mini app is identified by the URL its button opens, not by button text -
// the same app is labelled differently on the two surfaces ("Open in browser"
// vs "Open console"), and text is the thing a rename breaks while the button
// still works.
const KNOWN_MINI_APPS = new Map([
  ['Console', (urls) => urls.consoleUrl],
  ['Resident Spy', (urls) => urls.liveUrl],
]);

let trackedPaths = [];
afterEach(() => {
  while (trackedPaths.length) {
    fs.rmSync(trackedPaths.pop(), { recursive: true, force: true });
  }
});

function buttonUrls(keyboard) {
  return keyboard.flat().map((b) => b.url ?? b.webAppUrl).filter(Boolean);
}

function setupProjectRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1060-'));
  trackedPaths.push(root);
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  fs.writeFileSync(path.join(opDir, 'telegram-topic-map.json'),
    JSON.stringify({ [String(TOPIC_ID)]: RESIDENT_SPY_SUBJECT_ID }));
  fs.writeFileSync(path.join(opDir, 'telegram-standing-topic-titles.json'),
    JSON.stringify({ [RESIDENT_SPY_SUBJECT_ID]: RESIDENT_SPY_TOPIC_NAME }));
  return root;
}

// A fake Bot API that enforces the rule the live one enforces: any `url:`
// inline-keyboard button on an unaccepted scheme is a 400, exactly as
// Telegram answered every rotation before this fix.
function schemeEnforcingBot(ctx) {
  const calls = [];
  const reject = (body) => {
    const keyboard = body?.reply_markup?.inline_keyboard;
    if (!keyboard) return null;
    const violations = findButtonUrlSchemeViolations(keyboard);
    if (!violations.length) return null;
    return {
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        description: `Bad Request: inline keyboard button URL '${violations[0].url}' is invalid: Unsupported URL protocol`,
      }),
    };
  };
  const handler = async (url, opts) => {
    const u = String(url);
    const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url: u, body });
    if (u.includes('/getMe')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'SwarmForgeBot' } }) };
    }
    if (u.includes('/setChatMenuButton')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    }
    if (u.includes('/sendMessage')) {
      return reject(body) ?? { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 555 } }) };
    }
    if (u.includes('/editMessageText')) {
      return reject(body) ?? { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    }
    if (u.includes('/deleteMessage') || u.includes('/editForumTopic')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    }
    if (u.includes('/createForumTopic')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_thread_id: 888 } }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  ctx.calls = calls;
  return handler;
}

async function withEnvAndFetch(vars, handler, run) {
  const prevFetch = global.fetch;
  const prev = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  global.fetch = handler;
  try {
    return await run();
  } finally {
    global.fetch = prevFetch;
    for (const key of Object.keys(prev)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a live tunnel URL carrying a pairing token$/, (ctx) => {
    ctx.liveUrl = LIVE_URL;
    ctx.urls = buildResidentSpyTunnelUrls(BASE, TUNNEL_TOKEN);
    // Asserted, not assumed: without a token in the tunnel URL, scenario 01's
    // "carries the token" step would be comparing two empty strings.
    assert.equal(new URL(ctx.urls.liveUrl).searchParams.get('bearer'), TUNNEL_TOKEN);
  });

  scoped(/^a keyboard built with the bare app-scheme pairing URI$/, (ctx) => {
    // The exact keyboard HEAD shipped - the defect held still, so scenario 03
    // measures the check against the real offending value rather than a
    // hand-typed lookalike.
    ctx.deepLink = buildBubblePairingDeepLink(LIVE_URL);
    ctx.keyboard = [[{ text: 'Update Bubble pairing', url: ctx.deepLink }]];
  });

  scoped(/^a Telegram bot that rejects a button URL on any other scheme$/, (ctx) => {
    ctx.fetchHandler = schemeEnforcingBot(ctx);
  });

  scoped(/^the "(.+)" keyboard is built$/, (ctx, surface) => {
    assert.ok(KNOWN_SURFACES.has(surface),
      `unknown surface "${surface}" - the handlers know ${[...KNOWN_SURFACES.keys()].join(', ')}`);
    ctx.surface = surface;
    ctx.keyboard = KNOWN_SURFACES.get(surface)(ctx.urls);
    ctx.pairButton = ctx.keyboard.flat().find((b) => b.text === 'Update Bubble pairing');
    assert.ok(ctx.pairButton, `the ${surface} keyboard offers no "Update Bubble pairing" button`);
  });

  scoped(/^that keyboard is checked against the accepted schemes$/, (ctx) => {
    ctx.violations = findButtonUrlSchemeViolations(ctx.keyboard);
  });

  scoped(/^the tunnel notifier runs for a rotated tunnel URL$/, async (ctx) => {
    const root = setupProjectRoot();
    const env = {
      TELEGRAM_BOT_TOKEN: BOT_TOKEN,
      TELEGRAM_CHAT_ID: CHAT_ID,
      TELEGRAM_PRINCIPAL_USER_ID: PRINCIPAL_ID,
    };
    ctx.result = await withEnvAndFetch(env, ctx.fetchHandler, async () => {
      // The pre-rotation state: one message already in the topic, so the
      // rotation below EDITS it rather than posting a first one.
      const seeded = await notifyResidentSpyTunnelUrl(root, PREV_LIVE_URL);
      assert.equal(seeded.notified, true,
        `the pre-rotation post failed, so the rotation has nothing to edit: ${JSON.stringify(seeded)}`);
      ctx.calls.length = 0;
      return notifyResidentSpyTunnelUrl(root, LIVE_URL);
    });
  });

  scoped(/^its pairing button URL uses the https scheme$/, (ctx) => {
    assert.match(ctx.pairButton.url, /^https:\/\//,
      `the ${ctx.surface} pairing button carries "${ctx.pairButton.url}", which the Bot API rejects`);
  });

  scoped(/^that URL addresses the bridge pair page$/, (ctx) => {
    assert.equal(new URL(ctx.pairButton.url).pathname, '/pair',
      'the button must reach the bridge pre-auth /pair page, which any browser can open');
  });

  scoped(/^it carries the token from the live tunnel URL$/, (ctx) => {
    assert.equal(new URL(ctx.pairButton.url).searchParams.get('token'), TUNNEL_TOKEN,
      're-pairing needs the live token; a pair page without it cannot pair');
  });

  scoped(/^every button URL in it uses an accepted scheme$/, (ctx) => {
    const violations = findButtonUrlSchemeViolations(ctx.keyboard);
    assert.deepEqual(violations, [],
      `${ctx.surface} keyboard: ${describeViolations(violations)}`);
    // Asserted so the step cannot pass over an empty keyboard.
    assert.ok(buttonUrls(ctx.keyboard).length > 0, `the ${ctx.surface} keyboard carries no URLs at all`);
  });

  scoped(/^the check fails$/, (ctx) => {
    assert.equal(ctx.violations.length, 1,
      `the app-scheme URI ${ctx.deepLink} was accepted by the check`);
  });

  scoped(/^it names the offending scheme$/, (ctx) => {
    const scheme = ctx.violations[0].scheme;
    assert.ok(!ACCEPTED_BUTTON_URL_SCHEMES.includes(scheme));
    assert.equal(scheme, `${new URL(ctx.deepLink).protocol}`);
    assert.match(describeViolations(ctx.violations), new RegExp(scheme));
  });

  scoped(/^the topic message is edited$/, (ctx) => {
    assert.equal(ctx.result.notified, true, `notifier reported ${JSON.stringify(ctx.result)}`);
    assert.equal(ctx.result.outcome, 'edited',
      `the topic edit did not succeed against a scheme-enforcing bot: ${JSON.stringify(ctx.result)}`);
  });

  scoped(/^the private direct message is sent$/, (ctx) => {
    assert.equal(ctx.result.privateOutcome, 'private-dm-sent',
      `the private DM did not reach the principal: ${JSON.stringify(ctx.result)}`);
    const dm = ctx.calls.find((c) => c.url.includes('/sendMessage') && c.body?.chat_id === PRINCIPAL_ID);
    assert.ok(dm, 'no sendMessage call was made to the principal user');
  });

  scoped(/^it still offers the "(.+)" button$/, (ctx, miniApp) => {
    assert.ok(KNOWN_MINI_APPS.has(miniApp),
      `unknown mini app "${miniApp}" - the handlers know ${[...KNOWN_MINI_APPS.keys()].join(', ')}`);
    const expected = KNOWN_MINI_APPS.get(miniApp)(ctx.urls);
    assert.ok(buttonUrls(ctx.keyboard).includes(expected),
      `the ${ctx.surface} keyboard no longer offers the ${miniApp} mini app (${expected}); it offers ${JSON.stringify(buttonUrls(ctx.keyboard))}`);
  });
}

module.exports = { registerSteps };
