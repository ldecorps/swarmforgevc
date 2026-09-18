'use strict';

// BL-1627: step handlers for "Tracked shell scripts run on bash 3.2 and the
// guard runs on any host" (specifier-authored feature, lands with this
// handler in the same parcel - BL-233, BL-1371).
//
// Scenario 01 scans the two fixed guard scripts directly, using the SAME
// construct regexes and comment-stripping BL-937's own static scan uses
// (never a re-derivation of that logic). Scenario 02 drives BL-937's own
// scan over the whole tree for real. Scenario 03 reads BL-937's feature
// source directly, proving the host-premise scenarios are gone and the
// scan scenario is intact.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE = 'BL-1627 Tracked shell scripts run on bash 3.2 and the guard runs on any host';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BL937_FEATURE = path.join(REPO_ROOT, 'specs', 'features', 'BL-937-shell-scripts-run-on-stock-macos-bash-32.feature');

// Explicit known values per the Scenario Outline handler rule.
const KNOWN_SCRIPTS = new Set([
  'swarmforge/scripts/check_bb_scripts_load.sh',
  'swarmforge/scripts/check_constitution_doc_citations.sh',
]);

// Same shapes as bl937ShellScriptsRunOnStockMacosBash32Steps.js's own
// scenario 02 - not re-imported (that module's exports are internal), but
// literally the same regex/strip logic, so a drift between the two would
// be a real defect this parcel's own acceptance run would catch.
function stripComments(content) {
  return content
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

const CONSTRUCT_REGEXES = {
  'mapfile or readarray': /\b(?:mapfile|readarray)\b/,
  'case-converting parameter expansion': /\$\{\w+(?:\^\^|\^|,,|,)\}/,
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────

  scoped(/^(\S+) is scanned with the portability feature's construct regexes, comment lines excluded$/, (ctx, token) => {
    assert.ok(KNOWN_SCRIPTS.has(token), `bl1627: unknown script in Examples: ${token}`);
    const content = stripComments(fs.readFileSync(path.join(REPO_ROOT, token), 'utf8'));
    ctx.bl1627Hits = Object.entries(CONSTRUCT_REGEXES)
      .filter(([, regex]) => regex.test(content))
      .map(([name]) => name);
  });

  scoped(/^no occurrence is found$/, (ctx) => {
    assert.deepEqual(ctx.bl1627Hits, [], `expected no construct occurrence, found: ${JSON.stringify(ctx.bl1627Hits)}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────

  scoped(/^BL-937's static construct scan runs over the repository's tracked shell scripts$/, (ctx) => {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--', '*.sh'], { encoding: 'utf8' });
    const files = out.split('\n').filter(Boolean);
    const hits = [];
    for (const rel of files) {
      const content = stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
      for (const [name, regex] of Object.entries(CONSTRUCT_REGEXES)) {
        if (regex.test(content) && rel !== 'swarmforge/scripts/test/test_route_backlog_role_label_bash32.sh') {
          hits.push(`${rel}: ${name}`);
        }
      }
    }
    ctx.bl1627ScanHits = hits;
  });

  scoped(/^it reports no occurrence of any construct$/, (ctx) => {
    assert.deepEqual(ctx.bl1627ScanHits, [], `expected the scan to be clean, found: ${JSON.stringify(ctx.bl1627ScanHits)}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────

  scoped(/^the source of BL-937's feature file is read$/, (ctx) => {
    ctx.bl937Source = fs.readFileSync(BL937_FEATURE, 'utf8');
  });

  scoped(/^it carries no step reading "the stock system bash reports version 3\.2"$/, (ctx) => {
    // A comment line may still discuss the retired step in prose (this
    // ticket's own header explains WHY it was retired); only an actual
    // Gherkin step line is the claim under test.
    const stepLines = ctx.bl937Source
      .split('\n')
      .filter((l) => /^\s*(Given|When|Then|And|But)\b/.test(l));
    assert.ok(
      !stepLines.some((l) => l.includes('the stock system bash reports version 3.2')),
      'expected the host-premise step gone from BL-937\'s feature'
    );
  });

  scoped(/^it still carries the static construct scan scenario$/, (ctx) => {
    assert.ok(
      ctx.bl937Source.includes('no tracked shell script reaches for a construct stock bash 3.2 lacks'),
      'expected the static construct scan scenario intact'
    );
  });
}

module.exports = { registerSteps };
