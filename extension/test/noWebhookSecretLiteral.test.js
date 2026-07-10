const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

// BL-225: GitGuardian flagged a committed whsec_-prefixed literal (Svix's
// own publicly documented example secret, confirmed not a real credential)
// across 26+ commits - every occurrence was a test fixture / evidence-doc
// literal for BL-217's svix-style signature check, never production
// config. This regression guard greps the WHOLE tracked tree (not just
// extension/) so a future fixture can never silently reintroduce a
// scanner-tripping literal. A runtime-built secret ('whsec_' +
// Buffer.from(seed).toString('base64'), the sanctioned fixture pattern
// this ticket switched to) never matches, since a quote character always
// sits right after whsec_ in the source text.

const REPO_ROOT = path.join(__dirname, '..', '..');
// Stryker (extension/stryker.config.json) sandboxes only the extension/
// subtree it mutates - the repo root (and everything outside extension/)
// genuinely does not exist there, same guard as gettingStartedDrift.test.js
// uses for docs/GettingStarted.md.
const repoRootAvailable = fs.existsSync(path.join(REPO_ROOT, 'docs', 'GettingStarted.md'));

test('BL-225 no-literal-secret-01: no tracked file embeds a whsec_ high-entropy secret literal', (t) => {
  if (!repoRootAvailable) {
    t.skip('repo root not present outside extension/ in this sandbox');
    return;
  }
  let output = '';
  try {
    output = execFileSync('git', ['grep', '-nE', 'whsec_[A-Za-z0-9+/]{20,}'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch (err) {
    // git grep's own exit code convention: 1 means "ran fine, no match" -
    // execFileSync throws for any non-zero exit, so that specific case is
    // the PASSING outcome here, not a real error.
    if (err.status === 1) {
      output = '';
    } else {
      throw err;
    }
  }
  assert.equal(
    output,
    '',
    `found a whsec_ high-entropy literal - build the fixture secret at runtime instead ('whsec_' + Buffer.from(seed).toString('base64')):\n${output}`
  );
});
