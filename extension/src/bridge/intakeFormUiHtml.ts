// BL-1732: Telegram Mini App shell for the Intake form. Reads the shared
// vocabulary from GET /intake-form-state, offers the three narrative
// dropdowns (each with "add new…", kept local to this draft until
// Submit), one or more free-text scenarios, an optional rule field and
// optional notes, and posts the draft to POST /intake-form/submit. No
// browser storage (Architecture rule 3) - the vocabulary is re-fetched on
// load; a draft lives only in page memory.

export function getIntakeFormUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>File an intake</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    padding: 12px 14px calc(20px + env(safe-area-inset-bottom, 0px));
  }
  h1 { font-size: 15px; margin: 0 0 12px; }
  label { display: block; font-size: 12px; color: var(--tg-theme-hint-color, #8b949e); margin: 12px 0 4px; }
  select, textarea, input[type="text"] {
    padding: 8px; font-size: 16px; border-radius: 6px;
    background: #161b22; color: inherit; border: 1px solid #30363d;
  }
  textarea, input[type="text"] { width: 100%; }
  textarea { min-height: 70px; resize: vertical; }
  #actor, #action, #goal { display: inline-block; width: auto; max-width: 100%; }
  button {
    margin-top: 16px; width: 100%; padding: 10px; font-size: 14px;
    border-radius: 6px; border: none; background: #238636; color: #fff;
  }
  button:disabled { opacity: 0.5; }
  .add-new { display: flex; gap: 6px; margin-top: 4px; }
  .status { font-size: 12px; margin-top: 10px; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>File an intake</h1>
<div>As <select id="actor"></select>, I want to <select id="action"></select>, so I can <select id="goal"></select>.</div>

<label for="scenarios">Scenarios (Given/When/Then)</label>
<textarea id="scenarios" placeholder="Given ...&#10;When ...&#10;Then ..."></textarea>

<label for="rule">Any rule that should always hold? (optional)</label>
<textarea id="rule"></textarea>

<label for="notes">Notes (optional)</label>
<textarea id="notes"></textarea>

<button id="submit">Submit</button>
<div class="status" id="status"></div>

<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  var params = new URLSearchParams(location.search);
  var token = params.get('bearer') || params.get('token') || '';
  var q = token ? ('?bearer=' + encodeURIComponent(token)) : '';

  var newValues = {};
  // BL-1732 hardener: the value ADDED for each slot this session, kept
  // separately from newValues (which QA bounce D2 clears on switch-away)
  // - the added <option> stays in the DOM permanently, so re-selecting it
  // after switching away is a real interaction, and the draft's own final
  // choice must still be recognized as the added value and promoted.
  var addedValues = {};
  var vocab = { actor: [], action: [], goal: [] };
  var statusEl = document.getElementById('status');

  function controlAuthHeaders() {
    if (!token) {
      return { 'content-type': 'application/json' };
    }
    return {
      'content-type': 'application/json',
      authorization: 'Bearer ' + token,
      'x-control-token': token,
    };
  }

  function fillDropdown(slot) {
    var el = document.getElementById(slot);
    el.innerHTML = '';
    vocab[slot].forEach(function (value) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      el.appendChild(opt);
    });
    var addOpt = document.createElement('option');
    addOpt.value = '__add_new__';
    addOpt.textContent = 'add new…';
    el.appendChild(addOpt);
    el.addEventListener('change', function () {
      if (el.value === '__add_new__') {
        var value = (prompt('New ' + slot + ' value:') || '').trim();
        if (value) {
          newValues[slot] = value;
          addedValues[slot] = value;
          var opt = document.createElement('option');
          opt.value = value;
          opt.textContent = value;
          el.insertBefore(opt, el.lastChild);
          el.value = value;
        } else {
          el.value = vocab[slot][0] || '';
        }
      } else if (addedValues[slot] !== undefined && el.value === addedValues[slot]) {
        // BL-1732 hardener: re-selecting the value THIS session added,
        // after having switched away from it, must re-arm newValues[slot]
        // - the added <option> is still in the DOM, and picking it back is
        // exactly as much a genuine final choice as picking it the first
        // time.
        newValues[slot] = addedValues[slot];
      } else if (newValues[slot] !== undefined) {
        // BL-1732 QA bounce D2: a value added via "add new" then abandoned
        // (this dropdown switched back to an existing value) must not
        // ride the next Submit as a leftover newValues[slot] - the server
        // also checks this (invariant 1), but the client should never
        // send a value the draft no longer uses in the first place.
        delete newValues[slot];
      }
    });
  }

  function loadState() {
    fetch('/intake-form-state' + q, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        vocab = data.vocabulary || vocab;
        ['actor', 'action', 'goal'].forEach(fillDropdown);
      })
      .catch(function () {
        statusEl.textContent = 'Could not load the vocabulary.';
      });
  }

  document.getElementById('submit').addEventListener('click', function () {
    var draft = {
      actor: document.getElementById('actor').value,
      action: document.getElementById('action').value,
      goal: document.getElementById('goal').value,
      scenarios: document.getElementById('scenarios').value,
      rule: document.getElementById('rule').value,
      notes: document.getElementById('notes').value,
      newValues: newValues,
    };
    statusEl.textContent = 'Filing…';
    fetch('/intake-form/submit' + q, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify(draft),
    })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (result) {
        if (result.ok && result.body.success) {
          statusEl.textContent = result.body.confirmationText || 'Filed.';
          newValues = {};
          loadState();
        } else {
          statusEl.textContent = 'Refused: ' + (result.body.reason || 'unknown error');
        }
      })
      .catch(function () {
        statusEl.textContent = 'Submit failed.';
      });
  });

  loadState();
})();
</script>
</body>
</html>`;
}
