const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { getIntakeFormUiHtml } = require('../out/bridge/intakeFormUiHtml');

// BL-1732 hardener: getIntakeFormUiHtml()'s inline <script> is one opaque
// template-literal string to Stryker (mutate scopes out/**/*.js, but a
// parser never descends into a string) - the same class the constitution
// flags for getXxxUiHtml() screens. This file had NO test of any kind
// before this pass. Same technique as the epicReorderUiHtml/pausedPagerUiHtml
// harnesses: load the REAL emitted inline <script> into a stubbed DOM/fetch.

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no inline <script> found in getIntakeFormUiHtml() output');
  }
  return match[1];
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function renderScreen({ fetchImpl, url, promptImpl } = {}) {
  const html = getIntakeFormUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: url || 'https://example.github.io/intake/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  dom.fetchCalls = [];
  window.fetch = (u, opts) => {
    dom.fetchCalls.push({ url: u, opts });
    return (fetchImpl || (() => Promise.reject(new Error('unexpected fetch: ' + u))))(u, opts);
  };
  window.prompt = promptImpl || (() => null);
  window.eval(extractInlineScript(html));
  return dom;
}

function vocabResponse(vocab) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ vocabulary: vocab }) });
}

const VOCAB = {
  actor: ['the human', 'the operator'],
  action: ['file a new intake from my phone'],
  goal: ['know the swarm is working on it'],
};

// QA bounce D1 (art-director sign-off 615d4b23c7/000014,000016): the shared
// `select, textarea, input[type="text"] { width: 100%; ... }` rule made the
// three inline narrative selects (#actor/#action/#goal) full-width blocks,
// so "As <select>, I want to <select>, so I can <select>." rendered as three
// stacked dropdowns instead of one inline sentence.
test('D1: the narrative selects render inline, never full-width blocks', async () => {
  const dom = renderScreen({ fetchImpl: () => vocabResponse(VOCAB) });
  await flush();
  const { document, getComputedStyle } = dom.window;
  for (const id of ['actor', 'action', 'goal']) {
    const style = getComputedStyle(document.getElementById(id));
    assert.notEqual(style.display, 'block', `#${id} is a full-width block, not inline`);
    assert.notEqual(style.width, '100%', `#${id} is still width:100%`);
  }
});

// QA bounce D2 (art-director sign-off 6f97887741): every text-entry control
// was 14px, which the iOS WKWebView (Telegram Mini App) zooms the viewport
// on focus of. >=16px avoids the zoom.
test('D2: every text-entry control is at least 16px, avoiding iOS zoom-on-focus', async () => {
  const dom = renderScreen({ fetchImpl: () => vocabResponse(VOCAB) });
  await flush();
  const { document, getComputedStyle } = dom.window;
  for (const id of ['actor', 'action', 'goal', 'scenarios', 'rule', 'notes']) {
    const size = getComputedStyle(document.getElementById(id)).fontSize;
    assert.ok(parseFloat(size) >= 16, `#${id} is ${size}, under the 16px iOS zoom threshold`);
  }
});

test('loadState fills every dropdown with the vocabulary plus a trailing "add new…" option', async () => {
  const dom = renderScreen({ fetchImpl: () => vocabResponse(VOCAB) });
  await flush();
  const { document } = dom.window;
  const actorOptions = [...document.getElementById('actor').options].map((o) => o.value);
  assert.deepEqual(actorOptions, ['the human', 'the operator', '__add_new__']);
  const goalOptions = [...document.getElementById('goal').options].map((o) => o.value);
  assert.deepEqual(goalOptions, ['know the swarm is working on it', '__add_new__']);
});

test('loadState failure shows a plain status message, never a crash', async () => {
  const dom = renderScreen({ fetchImpl: () => Promise.reject(new Error('network down')) });
  await flush();
  assert.equal(dom.window.document.getElementById('status').textContent, 'Could not load the vocabulary.');
});

test('choosing "add new…" prompts, adds the value, and selects it', async () => {
  const dom = renderScreen({
    fetchImpl: () => vocabResponse(VOCAB),
    promptImpl: () => '  the cleaner  ',
  });
  await flush();
  const { document, window } = dom.window;
  const actorSelect = document.getElementById('actor');
  actorSelect.value = '__add_new__';
  actorSelect.dispatchEvent(new window.Event('change'));
  assert.equal(actorSelect.value, 'the cleaner');
  const options = [...actorSelect.options].map((o) => o.value);
  // the new option is inserted BEFORE the trailing "add new…" entry, never
  // after it (a mutant swapping insertBefore's reference node would still
  // pass a bare "does it exist" check but leave "add new…" no longer last).
  assert.deepEqual(options, ['the human', 'the operator', 'the cleaner', '__add_new__']);
});

// BL-1732 QA bounce D2 (invariant 1): newValues[slot] used to survive a
// later change back to an existing vocabulary value - the abandoned
// value then rode the next Submit and joined the shared vocabulary even
// though the draft never actually used it.
test('D2: switching a dropdown back to an existing value after "add new…" drops the abandoned newValues entry', async () => {
  const dom = renderScreen({
    fetchImpl: (url) => {
      if (String(url).startsWith('/intake-form-state')) {
        return vocabResponse(VOCAB);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    },
    promptImpl: () => 'the cleaner',
  });
  await flush();
  const { document, window } = dom.window;
  const actorSelect = document.getElementById('actor');
  actorSelect.value = '__add_new__';
  actorSelect.dispatchEvent(new window.Event('change'));
  assert.equal(actorSelect.value, 'the cleaner');

  // Switch back to an existing seeded value - the newly-added one is
  // abandoned, never chosen for this draft after all.
  actorSelect.value = 'the operator';
  actorSelect.dispatchEvent(new window.Event('change'));

  document.getElementById('submit').dispatchEvent(new window.Event('click'));
  await flush();
  await flush();
  const submitCall = dom.fetchCalls.find((c) => String(c.url).startsWith('/intake-form/submit'));
  const body = JSON.parse(submitCall.opts.body);
  assert.equal(body.actor, 'the operator');
  assert.equal('actor' in body.newValues, false, `expected no abandoned newValues.actor, got: ${JSON.stringify(body.newValues)}`);
});

// BL-1732 hardener: the added <option> stays in the DOM after a
// switch-away (D2's own fix only clears newValues[slot], never removes
// the option) - re-selecting it before Submit is a real interaction, and
// the draft's genuine final choice must still be promoted. Hand-verified
// this is load-bearing: without the addedValues re-arm, this test fails
// with an empty newValues (the exact regression the D2 fix alone
// introduces for this specific sequence).
test('re-selecting an added value after switching away re-arms it for promotion', async () => {
  const dom = renderScreen({
    fetchImpl: (url) => {
      if (String(url).startsWith('/intake-form-state')) {
        return vocabResponse(VOCAB);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    },
    promptImpl: () => 'the cleaner',
  });
  await flush();
  const { document, window } = dom.window;
  const actorSelect = document.getElementById('actor');
  actorSelect.value = '__add_new__';
  actorSelect.dispatchEvent(new window.Event('change'));
  assert.equal(actorSelect.value, 'the cleaner');

  // Switch away (abandoning it, per D2), then switch BACK to it before
  // Submit - the added option is still there to pick.
  actorSelect.value = 'the operator';
  actorSelect.dispatchEvent(new window.Event('change'));
  actorSelect.value = 'the cleaner';
  actorSelect.dispatchEvent(new window.Event('change'));

  document.getElementById('submit').dispatchEvent(new window.Event('click'));
  await flush();
  await flush();
  const submitCall = dom.fetchCalls.find((c) => String(c.url).startsWith('/intake-form/submit'));
  const body = JSON.parse(submitCall.opts.body);
  assert.equal(body.actor, 'the cleaner');
  assert.equal(body.newValues.actor, 'the cleaner', `expected the re-selected added value to be promoted, got: ${JSON.stringify(body.newValues)}`);
});

test('cancelling "add new…" (blank prompt) reverts to the first vocabulary value, never leaves __add_new__ selected', async () => {
  const dom = renderScreen({
    fetchImpl: () => vocabResponse(VOCAB),
    promptImpl: () => '   ',
  });
  await flush();
  const { document, window } = dom.window;
  const actorSelect = document.getElementById('actor');
  actorSelect.value = '__add_new__';
  actorSelect.dispatchEvent(new window.Event('change'));
  assert.equal(actorSelect.value, 'the human');
});

test('submit posts the full draft, with the control token in BOTH headers when present', async () => {
  const dom = renderScreen({
    url: 'https://example.github.io/intake/?bearer=secret-token',
    fetchImpl: (url) => {
      if (String(url).startsWith('/intake-form-state')) {
        return vocabResponse(VOCAB);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, confirmationText: 'Filed for the swarm: backlog/INTAKE-x.md' }),
      });
    },
  });
  await flush();
  const { document } = dom.window;
  document.getElementById('scenarios').value = 'Given a\nWhen b\nThen c';
  document.getElementById('rule').value = 'a rule';
  document.getElementById('notes').value = 'a note';
  document.getElementById('submit').dispatchEvent(new dom.window.Event('click'));
  await flush();
  await flush();

  const submitCall = dom.fetchCalls.find((c) => String(c.url).startsWith('/intake-form/submit'));
  assert.ok(submitCall, 'expected a POST to /intake-form/submit');
  assert.equal(submitCall.url, '/intake-form/submit?bearer=secret-token');
  assert.equal(submitCall.opts.method, 'POST');
  assert.equal(submitCall.opts.headers.authorization, 'Bearer secret-token');
  assert.equal(submitCall.opts.headers['x-control-token'], 'secret-token');
  const body = JSON.parse(submitCall.opts.body);
  assert.equal(body.scenarios, 'Given a\nWhen b\nThen c');
  assert.equal(body.rule, 'a rule');
  assert.equal(body.notes, 'a note');
  assert.equal(document.getElementById('status').textContent, 'Filed for the swarm: backlog/INTAKE-x.md');
});

test('submit with no bearer token omits BOTH auth headers, never sends an empty Bearer', async () => {
  const dom = renderScreen({
    fetchImpl: (url) => {
      if (String(url).startsWith('/intake-form-state')) {
        return vocabResponse(VOCAB);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    },
  });
  await flush();
  dom.window.document.getElementById('submit').dispatchEvent(new dom.window.Event('click'));
  await flush();
  await flush();
  const submitCall = dom.fetchCalls.find((c) => String(c.url).startsWith('/intake-form/submit'));
  assert.equal(submitCall.url, '/intake-form/submit');
  assert.equal('authorization' in submitCall.opts.headers, false);
  assert.equal('x-control-token' in submitCall.opts.headers, false);
});

test('submit refusal shows the server-supplied reason, never a bare HTTP status (BL-572/BL-662 shape)', async () => {
  const dom = renderScreen({
    fetchImpl: (url) => {
      if (String(url).startsWith('/intake-form-state')) {
        return vocabResponse(VOCAB);
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ success: false, reason: 'missing control token' }),
      });
    },
  });
  await flush();
  dom.window.document.getElementById('submit').dispatchEvent(new dom.window.Event('click'));
  await flush();
  await flush();
  const status = dom.window.document.getElementById('status').textContent;
  assert.equal(status, 'Refused: missing control token');
  assert.equal(status.includes('401'), false);
});

test('submit network failure shows a plain status message, never a crash', async () => {
  const dom = renderScreen({
    fetchImpl: (url) => {
      if (String(url).startsWith('/intake-form-state')) {
        return vocabResponse(VOCAB);
      }
      return Promise.reject(new Error('offline'));
    },
  });
  await flush();
  dom.window.document.getElementById('submit').dispatchEvent(new dom.window.Event('click'));
  await flush();
  await flush();
  assert.equal(dom.window.document.getElementById('status').textContent, 'Submit failed.');
});

test('a successful submit clears newValues and reloads the vocabulary (a later add-new starts clean)', async () => {
  let stateCalls = 0;
  const dom = renderScreen({
    fetchImpl: (url) => {
      if (String(url).startsWith('/intake-form-state')) {
        stateCalls++;
        return vocabResponse(VOCAB);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, confirmationText: 'Filed.' }) });
    },
  });
  await flush();
  assert.equal(stateCalls, 1, 'expected exactly one initial state load');
  dom.window.document.getElementById('submit').dispatchEvent(new dom.window.Event('click'));
  await flush();
  await flush();
  assert.equal(stateCalls, 2, 'expected a second state load after a successful submit');
});
