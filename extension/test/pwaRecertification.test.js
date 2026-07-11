const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// BL-150: renders the REAL pwa/index.html + pwa/app.js in jsdom (mirroring
// pwaDocsExplorer.test.js's own pattern), fed a fake recert-batch.json, and
// exercises confirm/update/delete by dispatching real click/input events.

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

function fakeBacklog() {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    board: { active: [], paused: [], doneByMilestone: {} },
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [] },
    },
  };
}

function fakeDocsTree(overrides = {}) {
  return { schemaVersion: 1, generatedAtIso: '2026-07-09T12:00:00Z', sourceSha: 'abc123def456', vision: [], milestones: [], tickets: [], ...overrides };
}

function fakeRecertBatch(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    recertEmailTo: 'recert@tolokarooo.resend.app',
    batch: [
      {
        id: 'BL-096/metrics-01',
        ticketId: 'BL-096',
        ticketTitle: 'Metrics dashboard',
        name: 'velocity series matches git-recorded closes',
        text: 'Scenario: velocity series matches git-recorded closes\n  Given a repo\n  Then counts match',
      },
    ],
    ...overrides,
  };
}

function renderDashboard(recertBatch, speech, docsTree) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  dom.window.fetch = (url) => {
    if (url === './backlog.json') {
      return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
    }
    if (url === './docs-tree.json') {
      return Promise.resolve({ json: () => Promise.resolve(docsTree || fakeDocsTree()) });
    }
    if (url === './recert-batch.json') {
      return Promise.resolve({ json: () => Promise.resolve(recertBatch) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };

  if (speech) {
    const calls = { spoken: [], cancelled: 0 };
    dom.window.SpeechSynthesisUtterance = function (text) {
      this.text = text;
      this.lang = '';
    };
    dom.window.speechSynthesis = {
      speak: (utterance) => {
        calls.spoken.push({ text: utterance.text, lang: utterance.lang });
      },
      cancel: () => {
        calls.cancelled += 1;
      },
    };
    dom.window.__speechCalls = calls;
  }

  const localesSource = fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8');
  dom.window.eval(localesSource);
  const appSource = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
  dom.window.eval(appSource);
  return dom;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function click(dom, element) {
  element.dispatchEvent(new dom.window.Event('click'));
}

function content(dom) {
  return dom.window.document.getElementById('recertContent');
}

function decodeMailto(href) {
  const url = new URL(href);
  return {
    to: decodeURIComponent(url.pathname),
    subject: url.searchParams.get('subject'),
    body: url.searchParams.get('body'),
  };
}

test('recert-01: shows the batch\'s (already oldest-first) scenario with its full text', async () => {
  const dom = renderDashboard(fakeRecertBatch());
  await flush();
  const text = content(dom).textContent;
  assert.match(text, /velocity series matches git-recorded closes/);
  assert.match(text, /Given a repo/);
});

test('an empty batch shows an explicit "nothing to review" state, not an error', async () => {
  const dom = renderDashboard(fakeRecertBatch({ batch: [] }));
  await flush();
  assert.match(content(dom).textContent, /No scenarios need recertification/);
});

test('recert-02: the Confirm link composes a mailto: with outcome "confirm" and the scenario id, no content change', async () => {
  const dom = renderDashboard(fakeRecertBatch());
  await flush();
  const confirmLink = [...content(dom).querySelectorAll('a')].find((a) => a.textContent.indexOf('Confirm') === 0);
  assert.ok(confirmLink, 'a Confirm link must be rendered');
  const mail = decodeMailto(confirmLink.href);
  assert.equal(mail.to, 'recert@tolokarooo.resend.app');
  assert.match(mail.subject, /confirm/);
  assert.match(mail.subject, /BL-096\/metrics-01/);
  assert.doesNotMatch(mail.body, /---/);
});

// BL-223 recert-address-01: proves the address is actually READ from the
// published recert-batch.json config, not a second app.js hardcode of the
// new literal - a differently-configured address (e.g. a later custom
// domain) must flow straight through with no code change.
test('BL-223 recert-address-01: the recert mailto targets the configured inbound address from recert-batch.json', async () => {
  const dom = renderDashboard(fakeRecertBatch({ recertEmailTo: 'recert@inbound.musicalsifu.com' }));
  await flush();
  const confirmLink = [...content(dom).querySelectorAll('a')].find((a) => a.textContent.indexOf('Confirm') === 0);
  assert.equal(decodeMailto(confirmLink.href).to, 'recert@inbound.musicalsifu.com');
});

// BL-223 recert-address-02: the reserved .invalid placeholder must never be
// used, whatever the configured or fallback address happens to be.
test('BL-223 recert-address-02: the reserved .invalid placeholder is never used', async () => {
  const dom = renderDashboard(fakeRecertBatch());
  await flush();
  const confirmLink = [...content(dom).querySelectorAll('a')].find((a) => a.textContent.indexOf('Confirm') === 0);
  assert.doesNotMatch(decodeMailto(confirmLink.href).to, /\.invalid$/);
});

// Every outcome shares recertMailtoHref's one recertEmailTo() lookup - a
// wrong or blank recipient here silently strands every recert mail (nothing
// bounces, nothing errors), and no other assertion in this file happens to
// touch the "to" address, so this must be checked explicitly on more than
// one outcome to catch a regression in the shared lookup itself, not just
// one call site.
test('recert-03/04: the Update and Delete send links use the same recert recipient address as Confirm', async () => {
  const dom = renderDashboard(fakeRecertBatch());
  await flush();
  click(dom, [...content(dom).querySelectorAll('button')].find((b) => b.textContent === 'Update text'));
  const updateSendLink = [...content(dom).querySelectorAll('a')].find((a) => a.textContent === 'Send update');
  assert.equal(decodeMailto(updateSendLink.href).to, 'recert@tolokarooo.resend.app');

  click(dom, [...content(dom).querySelectorAll('button')].find((b) => b.textContent === 'Cancel'));
  click(dom, [...content(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('Delete') === 0));
  const deleteSendLink = [...content(dom).querySelectorAll('a')].find((a) => a.textContent === 'Yes, delete');
  assert.equal(decodeMailto(deleteSendLink.href).to, 'recert@tolokarooo.resend.app');
});

test('recert-03: choosing Update reveals the current text for editing, and the Send link reflects live edits', async () => {
  const dom = renderDashboard(fakeRecertBatch());
  await flush();
  const updateBtn = [...content(dom).querySelectorAll('button')].find((b) => b.textContent === 'Update text');
  click(dom, updateBtn);

  const textarea = content(dom).querySelector('textarea');
  assert.ok(textarea, 'an editable textarea must appear for Update');
  assert.match(textarea.value, /Given a repo/);

  textarea.value = 'Scenario: edited\n  Given a new precondition';
  textarea.dispatchEvent(new dom.window.Event('input'));

  const sendLink = [...content(dom).querySelectorAll('a')].find((a) => a.textContent === 'Send update');
  const mail = decodeMailto(sendLink.href);
  assert.match(mail.subject, /update/);
  assert.match(mail.body, /edited/);
  assert.match(mail.body, /Given a new precondition/);
});

// --- BL-238 accessibility ---

test('BL-238: the Update text field has an accessible name (no <label for> pairing exists in this codebase)', async () => {
  const dom = renderDashboard(fakeRecertBatch());
  await flush();
  click(dom, [...content(dom).querySelectorAll('button')].find((b) => b.textContent === 'Update text'));

  const textarea = content(dom).querySelector('textarea');
  assert.ok(textarea.getAttribute('aria-label'), 'the textarea must have an aria-label, not rely on an unassociated heading');
  assert.match(textarea.getAttribute('aria-label'), /velocity series matches git-recorded closes/);
});

test('BL-238: a role="button" mailto: link also activates on Space, completing its ARIA button contract', async () => {
  const dom = renderDashboard(fakeRecertBatch());
  await flush();
  const confirmLink = [...content(dom).querySelectorAll('a')].find((a) => a.textContent.indexOf('Confirm') === 0);
  assert.equal(confirmLink.getAttribute('role'), 'button');

  let navigated = false;
  confirmLink.addEventListener('click', (e) => {
    navigated = true;
    e.preventDefault();
  });
  confirmLink.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));

  assert.equal(navigated, true, 'Space must activate a role="button" anchor the same way Enter/click already does natively');
});

test('recert-03: cancelling out of Update returns to the confirm/update/delete choice with nothing sent', async () => {
  const dom = renderDashboard(fakeRecertBatch());
  await flush();
  click(dom, [...content(dom).querySelectorAll('button')].find((b) => b.textContent === 'Update text'));
  click(dom, [...content(dom).querySelectorAll('button')].find((b) => b.textContent === 'Cancel'));
  assert.ok([...content(dom).querySelectorAll('a')].find((a) => a.textContent.indexOf('Confirm') === 0), 'must return to the normal choice screen');
});

test('recert-04: choosing Delete does NOT immediately offer a send affordance - it requires an explicit confirmation screen first', async () => {
  const dom = renderDashboard(fakeRecertBatch());
  await flush();
  const deleteBtn = [...content(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('Delete') === 0);
  click(dom, deleteBtn);

  assert.doesNotMatch(content(dom).textContent, /Given a repo/, 'the delete confirmation screen replaces the scenario view, not a silent send');
  const sendLink = [...content(dom).querySelectorAll('a')].find((a) => a.textContent === 'Yes, delete');
  assert.ok(sendLink, 'an explicit "Yes, delete" confirmation affordance must appear');
});

test('recert-04: the "Yes, delete" link (reached only after the confirmation screen) composes outcome "delete"', async () => {
  const dom = renderDashboard(fakeRecertBatch());
  await flush();
  click(dom, [...content(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('Delete') === 0));
  const confirmDeleteLink = [...content(dom).querySelectorAll('a')].find((a) => a.textContent === 'Yes, delete');
  const mail = decodeMailto(confirmDeleteLink.href);
  assert.match(mail.subject, /delete/);
  assert.match(mail.subject, /BL-096\/metrics-01/);
});

test('recert-04: cancelling the delete confirmation returns to the normal choice with no send link ever produced', async () => {
  const dom = renderDashboard(fakeRecertBatch());
  await flush();
  click(dom, [...content(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf('Delete') === 0));
  click(dom, [...content(dom).querySelectorAll('button')].find((b) => b.textContent === 'Cancel'));
  assert.equal([...content(dom).querySelectorAll('a')].find((a) => a.textContent === 'Yes, delete'), undefined);
  assert.ok([...content(dom).querySelectorAll('a')].find((a) => a.textContent.indexOf('Confirm') === 0), 'must return to the normal choice screen');
});

// --- BL-271: Listen control on the recert view ---

test('BL-271 recert-listen-01: activating Listen speaks the shown scenario\'s name followed by its Gherkin text', async () => {
  const dom = renderDashboard(fakeRecertBatch(), true);
  await flush();
  const listenBtn = [...content(dom).querySelectorAll('button')].find((b) => /listen/i.test(b.textContent));
  click(dom, listenBtn);

  assert.equal(dom.window.__speechCalls.spoken.length, 1);
  const spoken = dom.window.__speechCalls.spoken[0].text;
  const nameIndex = spoken.indexOf('velocity series matches git-recorded closes');
  const textIndex = spoken.indexOf('Given a repo');
  assert.ok(nameIndex !== -1 && textIndex !== -1, `expected both name and Gherkin text present in: ${spoken}`);
  assert.ok(nameIndex < textIndex, 'expected the scenario name spoken before its Gherkin text');
});

test('BL-271 recert-listen-02: the recert Listen control\'s accessible label tracks Listen/Stop state', async () => {
  const dom = renderDashboard(fakeRecertBatch(), true);
  await flush();
  const listenBtn = [...content(dom).querySelectorAll('button')].find((b) => /listen/i.test(b.textContent));
  assert.equal(listenBtn.getAttribute('aria-label'), 'Listen');

  click(dom, listenBtn);
  assert.equal(listenBtn.getAttribute('aria-label'), 'Stop');

  click(dom, listenBtn);
  assert.equal(listenBtn.getAttribute('aria-label'), 'Listen');
});

test('BL-271 recert-listen-03: no Listen control when nothing needs recertification', async () => {
  const dom = renderDashboard(fakeRecertBatch({ batch: [] }), true);
  await flush();
  const listenBtn = [...content(dom).querySelectorAll('button')].find((b) => /listen/i.test(b.textContent));
  assert.equal(listenBtn, undefined, 'expected no Listen control when recertNoneNeeded');
});

test('BL-271: with no on-device speech synthesis the recert Listen control degrades to a localized unavailable note', async () => {
  const dom = renderDashboard(fakeRecertBatch(), false);
  await flush();
  const listenBtn = [...content(dom).querySelectorAll('button')].find((b) => /listen/i.test(b.textContent));
  assert.equal(listenBtn, undefined, 'expected no listen button when speech synthesis is unavailable');
  assert.match(content(dom).textContent, /not available/i);
});

// --- BL-280: recert view shows the backlog item + tap-through ---

test('BL-280 recert-context-01: the recert card shows the scenario\'s ticket id and title above the scenario', async () => {
  const dom = renderDashboard(fakeRecertBatch());
  await flush();
  const contextLine = content(dom).querySelector('.recert-ticket-context');
  assert.ok(contextLine, 'expected a ticket-context element above the scenario');
  assert.equal(contextLine.textContent, 'BL-096 — Metrics dashboard');
  // it must render ABOVE the scenario name/text, not after.
  const text = content(dom).textContent;
  assert.ok(text.indexOf('BL-096 — Metrics dashboard') < text.indexOf('velocity series matches git-recorded closes'));
});

test('BL-280 recert-context-02: tapping the ticket line opens the full ticket detail in the docs explorer', async () => {
  const ticket = {
    id: 'BL-096',
    title: 'Metrics dashboard',
    status: 'active',
    priority: 5,
    milestone: 'M4',
    description: 'Full description of BL-096.',
    scenarios: [],
  };
  const dom = renderDashboard(fakeRecertBatch(), false, fakeDocsTree({ tickets: [ticket] }));
  await flush();
  const link = content(dom).querySelector('.recert-ticket-context');
  click(dom, link);
  const docsExplorer = dom.window.document.getElementById('docsExplorer');
  assert.match(docsExplorer.textContent, /Full description of BL-096\./);
});

test('BL-280 recert-context-03: the localized (French) ticket title is shown under the fr locale', async () => {
  const dom = renderDashboard(fakeRecertBatch({
    batch: [
      {
        id: 'BL-096/metrics-01',
        ticketId: 'BL-096',
        ticketTitle: 'Metrics dashboard',
        ticketTitleFr: 'Tableau de bord des métriques',
        name: 'velocity series matches git-recorded closes',
        text: 'Scenario: velocity series matches git-recorded closes\n  Given a repo\n  Then counts match',
      },
    ],
  }));
  await flush();
  click(dom, dom.window.document.getElementById('localeToggle'));
  const contextLine = content(dom).querySelector('.recert-ticket-context');
  assert.equal(contextLine.textContent, 'BL-096 — Tableau de bord des métriques');
});

test('BL-280 recert-context-04: a scenario with no resolvable ticket shows only its id, with no link and no error', async () => {
  const dom = renderDashboard(fakeRecertBatch({
    batch: [
      {
        id: 'BL-096/metrics-01',
        ticketId: 'BL-096',
        name: 'velocity series matches git-recorded closes',
        text: 'Scenario: velocity series matches git-recorded closes\n  Given a repo\n  Then counts match',
      },
    ],
  }));
  await flush();
  const contextEl = content(dom).querySelector('.recert-ticket-context');
  assert.ok(contextEl, 'expected the id to still render even with no resolvable ticket title');
  assert.equal(contextEl.textContent, 'BL-096');
  assert.equal(contextEl.tagName, 'P', 'expected a plain, non-interactive element - no link');
});

test('shows an honest failure message when the recert-batch fetch fails entirely', async () => {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/' });
  dom.window.fetch = (url) => {
    if (url === './backlog.json') {
      return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
    }
    if (url === './docs-tree.json') {
      return Promise.resolve({ json: () => Promise.resolve(fakeDocsTree()) });
    }
    return Promise.reject(new Error('offline, nothing cached'));
  };
  const localesSource = fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8');
  dom.window.eval(localesSource);
  const appSource = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
  dom.window.eval(appSource);
  await flush();
  assert.match(dom.window.document.getElementById('recertAsOf').textContent, /Could not load/);
});
