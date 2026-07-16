'use strict';

// BL-441: step handlers for the "answering offline" runbook feature. Reads
// the REAL docs/runbooks/BL-441-answering-offline-runbook.md straight off
// disk (repo-relative to this file) - a plain content check, no compiled
// module involved (this is a documentation-only ticket, mirrors
// docsWindowsClaimSteps's convention for docs-only features).
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNBOOK_PATH = path.join(REPO_ROOT, 'docs', 'runbooks', 'BL-441-answering-offline-runbook.md');

function registerSteps(registry) {
  // ── Background (shared across all 3 scenarios) ──────────────────────
  registry.define(/^the "answering offline" runbook$/, (ctx) => {
    ctx.runbook = fs.readFileSync(RUNBOOK_PATH, 'utf8');
  });

  registry.define(/^the human reads it$/, () => {
    // Nothing further to do - the Then steps below inspect ctx.runbook directly.
  });

  // ── answering-offline-runbook-01 ─────────────────────────────────────
  registry.define(
    /^it explains composing an ANSWER-\*\.md at the backlog root that references a BL id, topic, or ask id$/,
    (ctx) => {
      assert.match(
        ctx.runbook,
        /ANSWER-<anything>\.md|ANSWER-\*\.md/,
        'expected the runbook to name the ANSWER-*.md filename convention'
      );
      assert.match(
        ctx.runbook,
        /backlog root/i,
        'expected the runbook to say the answer file is committed at the backlog root'
      );
      assert.match(
        ctx.runbook,
        /BL-###|BL id|ticket you're answering/i,
        'expected the runbook to explain referencing a BL id, topic, or ask id'
      );
    }
  );

  // ── answering-offline-runbook-02 ─────────────────────────────────────
  registry.define(
    /^it points to the committed BL topics as the offline read surface and notes the PWA does not surface pending questions$/,
    (ctx) => {
      assert.match(
        ctx.runbook,
        /backlog\/topics\/\*\.json/,
        'expected the runbook to name the committed BL topics (backlog/topics/*.json) as the offline read surface'
      );
      assert.match(
        ctx.runbook,
        /PWA[^.]*does not surface|does not surface[^.]*PWA|Do not rely\s+on the PWA/i,
        'expected the runbook to note the PWA does not surface pending questions'
      );
    }
  );

  // ── answering-offline-runbook-03 ─────────────────────────────────────
  registry.define(
    /^it states that a late answer may be reported not-executed if the premise has moved on$/,
    (ctx) => {
      assert.match(
        ctx.runbook,
        /arrived\s+late,\s*not executed/i,
        'expected the runbook to state the "arrived late, not executed" stale-premise report'
      );
      assert.match(
        ctx.runbook,
        /premise has moved on|no longer live|not still live/i,
        'expected the runbook to explain the stale-premise condition'
      );
    }
  );
}

module.exports = { registerSteps };
