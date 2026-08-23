'use strict';

// BL-1064: step handlers for "every log literal is grounded against the source
// that writes it".
//
// Every scenario drives the REAL checker exported by
// bl643NonPipelineAgentsSteps.js against the REAL committed reference table -
// the same functions extension/test/bl643NonPipelineAgentPaths.property.test.js
// calls. Nothing here re-states which file writes which log; that map is the
// thing under test, and a second copy of it here would agree with itself while
// disagreeing with the checker.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach } = require('node:test');

const FEATURE = 'BL-1064 every log literal is grounded against the source that writes it';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const {
  parseReferenceTable,
  checkLogGrounding,
  logVerificationSources,
  logSourcesAreDeclared,
  extractBacktickSpans,
} = require(path.join(__dirname, 'bl643NonPipelineAgentsSteps'));

// The row this ticket exists for, and the file that actually writes the
// literal its launcher never could. Named here because scenario 01 is ABOUT
// this row; the mapping itself still lives in the checker.
const FRONT_DESK = 'Front Desk';
const DIAGNOSTICS_WRITER = path.join(REPO_ROOT, 'extension', 'src', 'tools', 'telegram-front-desk-bot.ts');

// Explicit known values per the Scenario Outline handler rule: a literal the
// handlers do not know is a hard failure, never a passthrough.
const KNOWN_LITERALS = new Set(['front-desk-supervisor.log', 'front-desk-diagnostics.log']);

let trackedPaths = [];
afterEach(() => {
  while (trackedPaths.length) {
    fs.rmSync(trackedPaths.pop(), { recursive: true, force: true });
  }
});

function logSpans(row) {
  return extractBacktickSpans(row['Log location']).filter((s) => s.startsWith('.') || s.includes('/'));
}

function rowNamed(agent) {
  const { rows } = parseReferenceTable();
  const row = rows.find((r) => r.Agent === agent);
  assert.ok(row, `the reference table has no "${agent}" row`);
  return row;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a row whose log literal is written by something other than its launcher$/, (ctx) => {
    ctx.row = rowNamed(FRONT_DESK);
    // Asserted, not assumed. If the launcher ever DID write the diagnostics
    // literal, this scenario would pass while testing nothing - the whole
    // premise is that it cannot.
    const launcher = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'launch_front_desk.sh');
    assert.ok(fs.existsSync(launcher), 'the Front Desk launcher is missing');
    assert.ok(!fs.readFileSync(launcher, 'utf8').includes('front-desk-diagnostics'),
      'the launcher now writes the diagnostics literal - this scenario no longer describes a real case');
    assert.ok(fs.readFileSync(DIAGNOSTICS_WRITER, 'utf8').includes('front-desk-diagnostics'),
      `the diagnostics literal is not written by ${path.relative(REPO_ROOT, DIAGNOSTICS_WRITER)} either`);
  });

  scoped(/^a row carrying a log literal no verification source contains$/, (ctx) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1064-'));
    trackedPaths.push(dir);
    const launcher = path.join(dir, 'fixture_launcher.sh');
    fs.writeFileSync(launcher, '#!/usr/bin/env bash\necho nothing-here\n');
    ctx.row = {
      Agent: 'BL-1064 Fixture Row',
      Launcher: `[\`fixture_launcher.sh\`](${launcher})`,
      'Stop path': '— none —',
      'Role prompt': '— none —',
      'Log location': '`.swarmforge/operator/bl1064-ungrounded.log`',
    };
    ctx.expectedLiteral = 'bl1064-ungrounded.log';
  });

  scoped(/^the row's verification sources are resolved$/, (ctx) => {
    ctx.sources = logVerificationSources(ctx.row);
    ctx.declared = logSourcesAreDeclared(ctx.row);
  });

  scoped(/^the "(.+)" row's log literal (.+) is grounded$/, (ctx, agent, literal) => {
    assert.equal(agent, FRONT_DESK, `this feature's scenarios are written about ${FRONT_DESK}`);
    assert.ok(KNOWN_LITERALS.has(literal),
      `unknown literal "${literal}" - the handlers know ${[...KNOWN_LITERALS].join(', ')}`);
    ctx.row = rowNamed(agent);
    ctx.literal = literal;
    // The literal must genuinely be in the table, or the scenario is asserting
    // about a row that no longer makes the claim.
    assert.ok(logSpans(ctx.row).some((s) => s.endsWith(literal)),
      `the ${agent} row no longer names ${literal} in its Log location cell`);
    ctx.sources = logVerificationSources(ctx.row);
  });

  scoped(/^the grounding check runs$/, (ctx) => {
    try {
      checkLogGrounding(ctx.row);
      ctx.error = null;
    } catch (e) {
      ctx.error = e;
    }
  });

  scoped(/^the resolved sources include the file that writes that literal$/, (ctx) => {
    assert.ok(ctx.declared,
      `the ${ctx.row.Agent} row's sources are still DERIVED from its launcher - a launcher that cannot contain the literal`);
    assert.ok(ctx.sources && ctx.sources.length > 0, 'no verification sources resolved');
    const resolved = ctx.sources.map((p) => path.resolve(p));
    assert.ok(resolved.includes(path.resolve(DIAGNOSTICS_WRITER)),
      `the resolved sources do not include the file that writes the literal; got ${resolved.join(', ')}`);
    for (const src of ctx.sources) {
      assert.ok(fs.existsSync(src), `a declared source does not exist: ${src}`);
    }
  });

  scoped(/^it is found in at least one of the row's verification sources$/, (ctx) => {
    assert.ok(ctx.sources && ctx.sources.length > 0, 'no verification sources resolved');
    const holders = ctx.sources.filter((s) => fs.readFileSync(s, 'utf8').includes(ctx.literal.replace('.log', '')));
    assert.ok(holders.length > 0,
      `${ctx.literal} appears in none of ${ctx.sources.map((p) => path.relative(REPO_ROOT, p)).join(', ')}`);
    // And the checker itself agrees - the assertion above reads the files, so
    // this pins that the shipped check reaches the same verdict.
    assert.doesNotThrow(() => checkLogGrounding(ctx.row),
      `the checker still rejects the ${ctx.row.Agent} row`);
  });

  scoped(/^it fails and names that row and that literal$/, (ctx) => {
    assert.ok(ctx.error, 'the grounding check accepted a row nothing grounds - it is vacuous');
    assert.match(ctx.error.message, new RegExp(ctx.row.Agent),
      `the failure does not name the row: ${ctx.error.message}`);
    assert.match(ctx.error.message, new RegExp(ctx.expectedLiteral),
      `the failure does not name the literal: ${ctx.error.message}`);
    // BL-1064's own lesson: a launcher-derived failure must say it was
    // derived, or the reader goes and edits prose that is already correct.
    assert.match(ctx.error.message, /DERIVED from the Launcher column/,
      `the failure does not say its sources were derived: ${ctx.error.message}`);
  });
}

module.exports = { registerSteps };
